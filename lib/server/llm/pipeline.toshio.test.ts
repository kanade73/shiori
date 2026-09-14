import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CanonFact, FabricatedFact, GenerationResult, Message } from "../types";

// issue #6: runConversationPipeline の中で「としお」がどう呼ばれるかを固定する。
// Gemini を叩く generate / toshio と、data/ を読む works / retrieval は差し替え、
// analyze（正規表現）と evaluate（決定的検査）は本物を通す。
const mocks = vi.hoisted(() => ({
  generateResponse: vi.fn(),
  generateToshioCommentary: vi.fn(),
  retrieveCanonFacts: vi.fn(),
  retrieveFabricatedFacts: vi.fn(),
  getAllCanonFacts: vi.fn(),
}));
vi.mock("./generate", () => ({ generateResponse: mocks.generateResponse }));
vi.mock("./toshio", () => ({ generateToshioCommentary: mocks.generateToshioCommentary }));
vi.mock("../retrieval", () => ({
  retrieveCanonFacts: mocks.retrieveCanonFacts,
  retrieveFabricatedFacts: mocks.retrieveFabricatedFacts,
}));
vi.mock("../works", () => ({
  getAllCanonFacts: mocks.getAllCanonFacts,
  getEntities: () => [],
  getArcs: () => [],
  getEpisodesUpTo: () => [],
}));

import { runConversationPipeline } from "./pipeline";

const visibleFact: CanonFact = {
  id: "cf-visible",
  workId: "w",
  episodeFrom: 1,
  subject: "A",
  relation: "likes",
  object: "B",
  description: "A は B が好き",
};
const hiddenFact: CanonFact = { ...visibleFact, id: "cf-hidden", episodeFrom: 10, description: "未視聴範囲の事実" };

const existingLie: FabricatedFact = {
  id: "ff-1",
  sessionId: "s1",
  subject: "C",
  relation: "lives_in",
  object: "D",
  negated: false,
  claim: "C は D に住んでいる",
  sourceCanonFactIds: [],
  introducedMessageId: "m0",
  confidence: 0.9,
  status: "active",
  createdAt: "2026-01-01T00:00:00Z",
};

function msg(overrides: Partial<Message>): Message {
  return { id: "m", sessionId: "s1", role: "assistant", content: "", createdAt: "2026-01-01T00:00:00Z", ...overrides };
}

function generation(overrides: Partial<GenerationResult> = {}): GenerationResult {
  return { message: "そうだね。", strategy: "no_new_lie", claims: [], usedExistingFactIds: [], spoilerRisk: 0, ...overrides };
}

const lieClaim = {
  subject: "A",
  relation: "has" as const,
  object: "赤い帽子",
  negated: false,
  claim: "A は赤い帽子を持っている",
  grounding: "fabricated" as const,
  sourceCanonFactIds: [],
};

const baseParams = {
  workId: "w",
  workTitle: "テスト作品",
  sessionId: "s1",
  currentEpisode: 3,
  history: [] as Message[],
  // 「伏線」を含むので analyze の questionType は theory になる
  userMessage: "これって伏線じゃない？",
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.retrieveCanonFacts.mockReturnValue([visibleFact]);
  mocks.retrieveFabricatedFacts.mockReturnValue([existingLie]);
  mocks.getAllCanonFacts.mockReturnValue([visibleFact, hiddenFact]);
  mocks.generateResponse.mockResolvedValue(generation({ claims: [lieClaim], strategy: "introduce_small_lie" }));
  mocks.generateToshioCommentary.mockResolvedValue({ shouldComment: true, message: "結論から言うとね……" });
});

describe("としおの割り込み: シオリの返答が確定した後に、材料を渡して1回だけ呼ぶ", () => {
  it("shouldComment=true なら message が toshioMessage になる", async () => {
    const result = await runConversationPipeline(baseParams);
    expect(mocks.generateToshioCommentary).toHaveBeenCalledTimes(1);
    expect(result.toshioMessage).toBe("結論から言うとね……");
  });

  it("としおにはシオリと同じ材料（視聴済み canonFacts・セッションの嘘・ユーザー発言・シオリの返答）を渡す", async () => {
    await runConversationPipeline(baseParams);
    expect(mocks.generateToshioCommentary).toHaveBeenCalledWith({
      workTitle: "テスト作品",
      currentEpisode: 3,
      canonFacts: [visibleFact],
      fabricatedFacts: [existingLie],
      userMessage: "これって伏線じゃない？",
      shioriMessage: "そうだね。",
    });
  });

  it("[企画の制約] としおに渡る canonFacts に未視聴範囲の事実は含まれない（getAllCanonFacts は evaluate 専用）", async () => {
    await runConversationPipeline(baseParams);
    const passed: CanonFact[] = mocks.generateToshioCommentary.mock.calls[0][0].canonFacts;
    expect(passed.map((f) => f.id)).not.toContain("cf-hidden");
  });

  it("shouldComment=false なら message があっても割り込まない", async () => {
    mocks.generateToshioCommentary.mockResolvedValue({ shouldComment: false, message: "無視されるべき" });
    const result = await runConversationPipeline(baseParams);
    expect(result.toshioMessage).toBeNull();
  });

  it("shouldComment=true でも message が空白だけなら割り込まない", async () => {
    mocks.generateToshioCommentary.mockResolvedValue({ shouldComment: true, message: "   " });
    const result = await runConversationPipeline(baseParams);
    expect(result.toshioMessage).toBeNull();
  });

  it("としお生成が失敗してもシオリの返答はそのまま返り、例外は伝播しない", async () => {
    mocks.generateToshioCommentary.mockRejectedValue(new Error("429"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await runConversationPipeline(baseParams);
    spy.mockRestore();
    expect(result.toshioMessage).toBeNull();
    expect(result.generation.message).toBe("そうだね。");
    expect(result.newFabricatedClaims).toHaveLength(1);
  });
});

describe("としおの割り込み: 呼ばない条件", () => {
  it("claims も無く、質問種別も impression なら Gemini を呼ばない", async () => {
    mocks.generateResponse.mockResolvedValue(generation({ claims: [] }));
    const result = await runConversationPipeline({ ...baseParams, userMessage: "1話面白かった" });
    expect(mocks.generateToshioCommentary).not.toHaveBeenCalled();
    expect(result.toshioMessage).toBeNull();
  });

  it("直近2ターン以内にとしおが話していれば呼ばない（連投防止）", async () => {
    const history = [
      msg({ role: "user", content: "a" }),
      msg({ speaker: "shiori", content: "b" }),
      msg({ speaker: "toshio", content: "c" }),
      msg({ role: "user", content: "d" }),
      msg({ speaker: "shiori", content: "e" }),
    ];
    const result = await runConversationPipeline({ ...baseParams, history });
    expect(mocks.generateToshioCommentary).not.toHaveBeenCalled();
    expect(result.toshioMessage).toBeNull();
  });

  it("としおの後にシオリが2回返答していれば再び呼ぶ", async () => {
    const history = [
      msg({ speaker: "toshio", content: "c" }),
      msg({ role: "user", content: "d" }),
      msg({ speaker: "shiori", content: "e" }),
      msg({ role: "user", content: "f" }),
      msg({ speaker: "shiori", content: "g" }),
    ];
    await runConversationPipeline({ ...baseParams, history });
    expect(mocks.generateToshioCommentary).toHaveBeenCalledTimes(1);
  });

  it("speaker が無い古いメッセージはシオリ扱いで、クールダウンの妨げにならない", async () => {
    const history = [msg({ role: "user", content: "a" }), msg({ content: "b" })];
    await runConversationPipeline({ ...baseParams, history });
    expect(mocks.generateToshioCommentary).toHaveBeenCalledTimes(1);
  });

  // としおは evaluate（ネタバレ・矛盾の事後検査）を通らない。シオリが「ネタバレ域なので
  // 逸らす」と判断した話題にそのまま乗せると、検査の無い経路で未視聴範囲に触れうる。
  it("[企画の制約] シオリが avoid_spoiler で逸らした話題には、としおを乗せない", async () => {
    mocks.generateResponse.mockResolvedValue(generation({ strategy: "avoid_spoiler", claims: [] }));
    const result = await runConversationPipeline({ ...baseParams, userMessage: "黒幕って誰なの？" });
    expect(mocks.generateToshioCommentary).not.toHaveBeenCalled();
    expect(result.toshioMessage).toBeNull();
  });

  it("[企画の制約] evaluate に2回落ちて定型の濁し返答に差し替わったときも、としおを呼ばない", async () => {
    // spoilerRisk が高いまま再生成も失敗 → SAFE_UNCERTAIN_MESSAGE に差し替わる
    mocks.generateResponse.mockResolvedValue(generation({ strategy: "introduce_small_lie", spoilerRisk: 0.9, claims: [] }));
    const result = await runConversationPipeline(baseParams);
    expect(result.regenerated).toBe(true);
    expect(result.generation.strategy).toBe("admit_uncertainty");
    expect(mocks.generateToshioCommentary).not.toHaveBeenCalled();
    expect(result.toshioMessage).toBeNull();
  });
});
