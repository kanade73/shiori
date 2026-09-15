import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CanonFact, Claim, FabricatedFact, GenerationResult, Message, UserMessageAnalysis } from "../types";

// issue #6: 「としお」がどう呼ばれるかと、generate → extract → evaluate の並びを固定する。
// Gemini を叩く generate / extract / toshio と、data/ を読む works / retrieval は差し替え、
// analyze（正規表現）・directive（純粋関数）・evaluate（決定的検査）は本物を通す。
const mocks = vi.hoisted(() => ({
  generateReply: vi.fn(),
  extractClaims: vi.fn(),
  generateToshioCommentary: vi.fn(),
  retrieveCanonFacts: vi.fn(),
  retrieveFabricatedFacts: vi.fn(),
  getActiveFabricatedFacts: vi.fn(),
  getAllCanonFacts: vi.fn(),
}));
vi.mock("./generate", () => ({ generateReply: mocks.generateReply }));
vi.mock("./extract", () => ({ extractClaims: mocks.extractClaims }));
vi.mock("./toshio", () => ({ generateToshioCommentary: mocks.generateToshioCommentary }));
vi.mock("../retrieval", () => ({
  retrieveCanonFacts: mocks.retrieveCanonFacts,
  retrieveFabricatedFacts: mocks.retrieveFabricatedFacts,
  getActiveFabricatedFacts: mocks.getActiveFabricatedFacts,
  // decideDirective（本物を通す）が関連判定に使う
  textIncludesAny: (text: string, needles: string[]) =>
    needles.some((n) => n.trim().length > 0 && text.toLowerCase().includes(n.toLowerCase())),
}));
vi.mock("../works", () => ({
  getAllCanonFacts: mocks.getAllCanonFacts,
  getEntities: () => [],
  getArcs: () => [],
  getEpisodesUpTo: () => [],
}));

import { runConversationPipeline, runToshioInterjection } from "./pipeline";

const SHIORI_REPLY = "そうだね。";

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
  return { message: SHIORI_REPLY, strategy: "no_new_lie", claims: [], ...overrides };
}

function analysis(overrides: Partial<UserMessageAnalysis> = {}): UserMessageAnalysis {
  return { mentionedCharacters: [], mentionedEvents: [], sentiment: "neutral", questionType: "theory", ...overrides };
}

const lieClaim: Claim = {
  subject: "A",
  relation: "has",
  object: "赤い帽子",
  negated: false,
  claim: "A は赤い帽子を持っている",
  grounding: "fabricated",
  sourceCanonFactIds: [],
};

const sessionParams = {
  workId: "w",
  workTitle: "テスト作品",
  sessionId: "s1",
  currentEpisode: 3,
  history: [] as Message[],
  userMessage: "これって伏線じゃない？",
};

/** シオリが小さな嘘を1つ言った直後、という標準的な材料 */
const toshioParams = {
  ...sessionParams,
  analysis: analysis(),
  generation: generation({ claims: [lieClaim], strategy: "introduce_small_lie" }),
  phase: "early" as const,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.retrieveCanonFacts.mockReturnValue([visibleFact]);
  mocks.retrieveFabricatedFacts.mockReturnValue([existingLie]);
  mocks.getActiveFabricatedFacts.mockReturnValue([existingLie]);
  mocks.getAllCanonFacts.mockReturnValue([visibleFact, hiddenFact]);
  mocks.generateReply.mockResolvedValue(SHIORI_REPLY);
  mocks.extractClaims.mockResolvedValue([lieClaim]);
  mocks.generateToshioCommentary.mockResolvedValue({ shouldComment: true, message: "結論から言うとね……" });
});

describe("runConversationPipeline: 会話（generate）と主張の取り出し（extract）を分ける", () => {
  it("generate 1回 + extract 1回で、返答文と claims を組み立てる", async () => {
    const result = await runConversationPipeline(sessionParams);
    expect(mocks.generateReply).toHaveBeenCalledTimes(1);
    expect(mocks.extractClaims).toHaveBeenCalledTimes(1);
    expect(result.generation.message).toBe(SHIORI_REPLY);
    expect(result.generation.claims).toEqual([lieClaim]);
  });

  it("extract には生成された返答文と、grounding 判定用の視聴済み canonFacts を渡す", async () => {
    await runConversationPipeline(sessionParams);
    const args = mocks.extractClaims.mock.calls[0][0];
    expect(args.text).toBe(SHIORI_REPLY);
    expect(args.workTitle).toBe("テスト作品");
    expect(args.canonFacts).toEqual([visibleFact]);
    expect(args.userMessage).toBe("これって伏線じゃない？");
    expect(typeof args.normalize).toBe("function");
  });

  it("extract が失敗しても返答文はそのまま返す（嘘が保存されないだけ）", async () => {
    mocks.extractClaims.mockRejectedValue(new Error("429"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await runConversationPipeline(sessionParams);
    spy.mockRestore();
    expect(result.generation.message).toBe(SHIORI_REPLY);
    expect(result.generation.claims).toEqual([]);
    expect(result.newFabricatedClaims).toEqual([]);
    expect(result.generation.strategy).toBe("no_new_lie");
  });

  it("バックエンドが決めた「今回の指示」（directive）を生成に渡し、結果にも載せる", async () => {
    const result = await runConversationPipeline(sessionParams);
    expect(mocks.generateReply.mock.calls[0][0].directive).toEqual(result.directive);
    expect(result.directive.kind).toBe("introduce");
  });

  it("生成には関係する数件の嘘（retrieveFabricatedFacts）を渡し、検査は全件（getActiveFabricatedFacts）に対して行う", async () => {
    // 正規化は小文字化を含むので、固定値には大小の無い名前を使う
    const other: FabricatedFact = { ...existingLie, id: "ff-2", subject: "ハチワレ", relation: "has", object: "青い帽子", claim: "ハチワレは青い帽子を持っている" };
    mocks.retrieveFabricatedFacts.mockReturnValue([existingLie]);
    mocks.getActiveFabricatedFacts.mockReturnValue([existingLie, other]);
    // 「ハチワレは青い帽子を持っていない」は、プロンプトに載せていない ff-2 と矛盾する
    mocks.extractClaims
      .mockResolvedValueOnce([{ ...lieClaim, subject: "ハチワレ", object: "青い帽子", negated: true, claim: "ハチワレは青い帽子を持っていない" }])
      .mockResolvedValueOnce([]);
    const result = await runConversationPipeline(sessionParams);
    expect(mocks.generateReply.mock.calls[0][0].fabricatedFacts).toEqual([existingLie]);
    expect(result.regenerated).toBe(true);
    // 差し戻し時は generate も extract ももう一度
    expect(mocks.generateReply).toHaveBeenCalledTimes(2);
    expect(mocks.extractClaims).toHaveBeenCalledTimes(2);
    expect(mocks.generateReply.mock.calls[1][0].feedback).toContain("ハチワレは青い帽子を持っている");
  });

  it("strategy はモデルに選ばせず、新しい嘘を保存するなら introduce_small_lie になる", async () => {
    const result = await runConversationPipeline(sessionParams);
    expect(result.generation.strategy).toBe("introduce_small_lie");
    expect(result.newFabricatedClaims).toHaveLength(1);
  });

  it("既存の嘘を言い直しただけなら reinforce_existing_lie、主張が無ければ no_new_lie", async () => {
    const stored: FabricatedFact = { ...existingLie, id: "ff-3", subject: "ハチワレ", relation: "lives_in", object: "洞窟", claim: "ハチワレは洞窟に住んでいる" };
    mocks.getActiveFabricatedFacts.mockReturnValue([stored]);
    mocks.extractClaims.mockResolvedValue([
      { ...lieClaim, subject: "ハチワレ", relation: "lives_in" as const, object: "洞窟", claim: "ハチワレは洞窟に住んでいる" },
    ]);
    const reinforced = await runConversationPipeline(sessionParams);
    expect(reinforced.generation.strategy).toBe("reinforce_existing_lie");
    expect(reinforced.reusedFabricatedFactIds).toEqual(["ff-3"]);
    mocks.extractClaims.mockResolvedValue([]);
    expect((await runConversationPipeline(sessionParams)).generation.strategy).toBe("no_new_lie");
  });
});

describe("runConversationPipeline: セッションの進行度（エスカレーション）", () => {
  it("嘘が溜まっていなければ early で、結果に載る", async () => {
    mocks.getActiveFabricatedFacts.mockReturnValue([]);
    const result = await runConversationPipeline(sessionParams);
    expect(result.phase).toBe("early");
    expect(result.directive.phase).toBe("early");
  });

  it("保存済みの嘘が積み上がると late になる（内容ではなく件数で決まる）", async () => {
    const many = Array.from({ length: 10 }, (_, i) => ({ ...existingLie, id: `ff-${i}`, introducedMessageId: `m-${i}` }));
    mocks.getActiveFabricatedFacts.mockReturnValue(many);
    const result = await runConversationPipeline(sessionParams);
    expect(result.phase).toBe("late");
  });

  it("history が打ち切られていても、呼び出し側が渡した userMessageCount で進行度を決められる", async () => {
    mocks.getActiveFabricatedFacts.mockReturnValue([]);
    const result = await runConversationPipeline({ ...sessionParams, userMessageCount: 30 });
    expect(result.phase).toBe("late");
  });
});

describe("runConversationPipeline はとしおを呼ばない", () => {
  it("シオリの返答を先に流せるよう、としおは別の関数（runToshioInterjection）に切り出してある", async () => {
    const result = await runConversationPipeline(sessionParams);
    expect(mocks.generateToshioCommentary).not.toHaveBeenCalled();
    expect(result).not.toHaveProperty("toshioMessage");
  });
});

describe("runToshioInterjection: シオリの返答が確定した後に、材料を渡して1回だけ呼ぶ", () => {
  it("shouldComment=true なら message を返す", async () => {
    const result = await runToshioInterjection(toshioParams);
    expect(mocks.generateToshioCommentary).toHaveBeenCalledTimes(1);
    expect(result).toBe("結論から言うとね……");
  });

  it("としおにはシオリと同じ取り方の材料（視聴済み canonFacts・セッションの嘘・ユーザー発言・シオリの返答）を渡す", async () => {
    await runToshioInterjection(toshioParams);
    expect(mocks.retrieveCanonFacts).toHaveBeenCalledWith("w", 3, toshioParams.analysis);
    expect(mocks.retrieveFabricatedFacts).toHaveBeenCalledWith("s1", toshioParams.analysis);
    expect(mocks.generateToshioCommentary).toHaveBeenCalledWith({
      workTitle: "テスト作品",
      currentEpisode: 3,
      canonFacts: [visibleFact],
      fabricatedFacts: [existingLie],
      userMessage: "これって伏線じゃない？",
      shioriMessage: SHIORI_REPLY,
      premises: [lieClaim],
    });
  });

  it("としおに渡す「題材」は、extract が取り出した claims のうち grounding=fabricated のものだけ", async () => {
    const canonClaim: Claim = { ...lieClaim, claim: "A は B が好き", grounding: "canon", sourceCanonFactIds: ["cf-visible"] };
    await runToshioInterjection({
      ...toshioParams,
      generation: generation({ message: "A は B が好き。赤い帽子もね。", claims: [canonClaim, lieClaim], strategy: "introduce_small_lie" }),
    });
    expect(mocks.generateToshioCommentary.mock.calls[0][0].premises).toEqual([lieClaim]);
  });

  it("[企画の制約] としおに渡る canonFacts に未視聴範囲の事実は含まれない（getAllCanonFacts は debug 画面専用）", async () => {
    await runToshioInterjection(toshioParams);
    const passed: CanonFact[] = mocks.generateToshioCommentary.mock.calls[0][0].canonFacts;
    expect(passed.map((f) => f.id)).not.toContain("cf-hidden");
  });

  it("shouldComment=false なら message があっても割り込まない", async () => {
    mocks.generateToshioCommentary.mockResolvedValue({ shouldComment: false, message: "無視されるべき" });
    expect(await runToshioInterjection(toshioParams)).toBeNull();
  });

  it("shouldComment=true でも message が空白だけなら割り込まない", async () => {
    mocks.generateToshioCommentary.mockResolvedValue({ shouldComment: true, message: "   " });
    expect(await runToshioInterjection(toshioParams)).toBeNull();
  });

  it("としお生成が失敗しても例外にせず null を返す（シオリの返答は既に確定済み）", async () => {
    mocks.generateToshioCommentary.mockRejectedValue(new Error("429"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await runToshioInterjection(toshioParams)).toBeNull();
    spy.mockRestore();
  });
});

describe("runToshioInterjection: 呼ばない条件", () => {
  it("claims も無く、質問種別も impression なら Gemini を呼ばない", async () => {
    const result = await runToshioInterjection({
      ...toshioParams,
      analysis: analysis({ questionType: "impression" }),
      generation: generation({ claims: [] }),
    });
    expect(mocks.generateToshioCommentary).not.toHaveBeenCalled();
    expect(result).toBeNull();
  });

  it("直近2ターン以内にとしおが話していれば呼ばない（連投防止）", async () => {
    const history = [
      msg({ role: "user", content: "a" }),
      msg({ speaker: "shiori", content: "b" }),
      msg({ speaker: "toshio", content: "c" }),
      msg({ role: "user", content: "d" }),
      msg({ speaker: "shiori", content: "e" }),
    ];
    const result = await runToshioInterjection({ ...toshioParams, history });
    expect(mocks.generateToshioCommentary).not.toHaveBeenCalled();
    expect(result).toBeNull();
  });

  it("[エスカレーション] 終盤（late）はクールダウンが外れ、直前がとしおでも割り込む", async () => {
    const history = [msg({ speaker: "shiori", content: "b" }), msg({ speaker: "toshio", content: "c" })];
    const result = await runToshioInterjection({ ...toshioParams, history, phase: "late" });
    expect(mocks.generateToshioCommentary).toHaveBeenCalledTimes(1);
    expect(result).toBe("結論から言うとね……");
  });

  it("としおの後にシオリが2回返答していれば再び呼ぶ", async () => {
    const history = [
      msg({ speaker: "toshio", content: "c" }),
      msg({ role: "user", content: "d" }),
      msg({ speaker: "shiori", content: "e" }),
      msg({ role: "user", content: "f" }),
      msg({ speaker: "shiori", content: "g" }),
    ];
    await runToshioInterjection({ ...toshioParams, history });
    expect(mocks.generateToshioCommentary).toHaveBeenCalledTimes(1);
  });

  it("speaker が無い古いメッセージはシオリ扱いで、クールダウンの妨げにならない", async () => {
    const history = [msg({ role: "user", content: "a" }), msg({ content: "b" })];
    await runToshioInterjection({ ...toshioParams, history });
    expect(mocks.generateToshioCommentary).toHaveBeenCalledTimes(1);
  });

  it("[企画の制約] evaluate に2回落ちて定型の濁し返答に差し替わったときも、としおを呼ばない", async () => {
    // 既存の嘘との矛盾が再生成でも消えない → SAFE_UNCERTAIN_MESSAGE に差し替わる
    const stored: FabricatedFact = { ...existingLie, id: "ff-cave", subject: "ハチワレ", relation: "lives_in", object: "洞窟", claim: "ハチワレは洞窟に住んでいる" };
    mocks.getActiveFabricatedFacts.mockReturnValue([stored]);
    mocks.extractClaims.mockResolvedValue([
      { ...lieClaim, subject: "ハチワレ", relation: "lives_in" as const, object: "海", claim: "ハチワレは海に住んでいる" },
    ]);
    const pipeline = await runConversationPipeline(sessionParams);
    expect(pipeline.regenerated).toBe(true);
    expect(pipeline.generation.strategy).toBe("admit_uncertainty");

    const result = await runToshioInterjection({
      ...sessionParams,
      analysis: pipeline.analysis,
      generation: pipeline.generation,
      phase: pipeline.phase,
    });
    expect(mocks.generateToshioCommentary).not.toHaveBeenCalled();
    expect(result).toBeNull();
  });
});
