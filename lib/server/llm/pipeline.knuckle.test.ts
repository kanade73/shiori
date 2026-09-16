import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Arc, Entity, GenerationResult, Message, SessionTopic } from "../types";

// issue #1 の「ナックルベンチ」: 「草むしり検定はハコワレが頑張っていて」→ ハチワレの誤字を聞き返す、
// 「ナックルとユピーの戦いは感動したよね」→ 別の作品（HUNTER×HUNTER）だと指摘する。
// analyze / names / directive は本物、Gemini を叩く generate / extract / 判定役と、data/ を読む works は差し替える。
const mocks = vi.hoisted(() => ({
  generateReply: vi.fn(),
  extractClaims: vi.fn(),
  lookupSessionTopic: vi.fn(),
  detectTopicShift: vi.fn(),
  detectOtherWork: vi.fn(),
  generateToshioCommentary: vi.fn(),
}));
vi.mock("./generate", () => ({ generateReply: mocks.generateReply }));
vi.mock("./extract", () => ({ extractClaims: mocks.extractClaims }));
vi.mock("./toshio", () => ({ generateToshioCommentary: mocks.generateToshioCommentary }));
vi.mock("../creator", () => ({ getCreatorProfiles: async () => [] }));
vi.mock("../topic", () => ({
  lookupSessionTopic: mocks.lookupSessionTopic,
  episodeBoundaryFor: (_w: string, t: SessionTopic | null) => (t ? 60 : 0),
  isSameTopic: (a: SessionTopic, b: SessionTopic) => a.title === b.title,
}));
vi.mock("../topic-shift", () => ({ detectTopicShift: mocks.detectTopicShift }));
vi.mock("../other-work", () => ({ detectOtherWork: mocks.detectOtherWork }));
vi.mock("../retrieval", () => ({
  retrieveCanonFacts: () => [],
  retrieveFabricatedFacts: () => [],
  getActiveFabricatedFacts: () => [],
  textIncludesAny: (text: string, needles: string[]) => needles.some((n) => n.trim().length > 0 && text.includes(n)),
}));

const entities: Entity[] = [
  { id: "hachiware", workId: "w", name: "ハチワレ", aliases: ["はちわれ", "ハチ"] },
  { id: "chiikawa", workId: "w", name: "ちいかわ", aliases: [] },
];
const arcs: Arc[] = [{ id: "arc-kentei", workId: "w", title: "草むしり検定編", episodeFrom: 50, episodeTo: 60, aliases: ["草むしり検定"] }];
vi.mock("../works", () => ({
  getCanonFactsUpTo: () => [],
  getEntities: () => entities,
  getArcs: () => arcs,
  getEpisodesUpTo: () => [],
}));

import { runConversationPipeline, runToshioInterjection } from "./pipeline";

const topic: SessionTopic = {
  title: "草むしり検定編",
  summary: "ハチワレが検定を受ける。",
  arcId: "arc-kentei",
  facts: [],
  sources: [],
  query: "草むしり検定",
  resolvedAt: "2026-09-16T00:00:00.000Z",
};
const params = { workId: "w", workTitle: "ちいかわ", sessionId: "s1", currentEpisode: 0, history: [] as Message[] };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.generateReply.mockResolvedValue("ハコワレ？ ハチワレのこと？");
  mocks.extractClaims.mockResolvedValue({ claims: [], backend: "gemini" });
  mocks.lookupSessionTopic.mockResolvedValue(topic);
  mocks.detectTopicShift.mockResolvedValue(null);
  mocks.detectOtherWork.mockResolvedValue(null);
});

describe("1発話目: 草むしり検定はハコワレが頑張っていてとても良かった。", () => {
  const userMessage = "草むしり検定はハコワレが頑張っていてとても良かった。";

  it("ハコワレをハチワレの誤字と見て、正式名に直した文で話題を調べる", async () => {
    await runConversationPipeline({ ...params, userMessage });
    expect(mocks.lookupSessionTopic).toHaveBeenCalledWith({
      workId: "w",
      workTitle: "ちいかわ",
      userMessage: "草むしり検定はハチワレが頑張っていてとても良かった。",
      ordinal: 1,
    });
  });

  it("解析ではハチワレの言及として扱い、誤字を添える。見知らぬ語は無い（判定役には渡らない）", async () => {
    const result = await runConversationPipeline({ ...params, userMessage });
    expect(result.analysis.mentionedCharacters).toEqual(["ハチワレ"]);
    expect(result.analysis.mentionedEvents).toEqual(["草むしり検定編"]);
    expect(result.analysis.nameCorrections).toEqual([{ written: "ハコワレ", entity: "ハチワレ" }]);
    expect(mocks.detectOtherWork).toHaveBeenCalledWith(expect.objectContaining({ unknownNames: [] }));
  });

  it("今回の指示は confirm_name。シオリには元の文（ハコワレ）を渡し、返答から主張は取り出さない", async () => {
    const result = await runConversationPipeline({ ...params, userMessage });
    expect(result.directive).toEqual({ kind: "confirm_name", phase: "early", corrections: [{ written: "ハコワレ", entity: "ハチワレ" }] });
    expect(mocks.generateReply.mock.calls[0][0]).toMatchObject({ userMessage, directive: result.directive, topic });
    expect(mocks.extractClaims).not.toHaveBeenCalled();
    expect(result.generation.claims).toEqual([]);
  });
});

describe("2発話目（ルート1）: ナックルとユピーの戦いは感動したよね。", () => {
  const userMessage = "ナックルとユピーの戦いは感動したよね。";
  const history: Message[] = [
    { id: "u1", sessionId: "s1", role: "user", content: "草むしり検定はハコワレが頑張っていてとても良かった。", createdAt: "2026-09-16T00:00:00.000Z" },
    { id: "a1", sessionId: "s1", role: "assistant", speaker: "shiori", content: "ハコワレ？ ハチワレのこと？", createdAt: "2026-09-16T00:00:01.000Z" },
  ];
  const otherWork = { otherWork: "HUNTER×HUNTER", names: ["ナックル", "ユピー"] };

  it("見知らぬ語（ナックル・ユピー）を判定役に渡す", async () => {
    await runConversationPipeline({ ...params, history, userMessage });
    expect(mocks.detectOtherWork).toHaveBeenCalledWith({ workId: "w", workTitle: "ちいかわ", userMessage, unknownNames: ["ナックル", "ユピー"] });
  });

  it("別の作品なら other_work。話題は調べず・切り替えも判定せず、主張も取り出さない", async () => {
    mocks.detectOtherWork.mockResolvedValue(otherWork);
    mocks.generateReply.mockResolvedValue("さっきからハンターハンターの話じゃない？");
    const result = await runConversationPipeline({ ...params, history, userMessage });
    expect(result.directive).toEqual({ kind: "other_work", phase: "early", otherWork: "HUNTER×HUNTER", names: ["ナックル", "ユピー"] });
    expect(mocks.lookupSessionTopic).not.toHaveBeenCalled();
    expect(mocks.detectTopicShift).not.toHaveBeenCalled();
    expect(mocks.extractClaims).not.toHaveBeenCalled();
    expect(result.newTopic).toBeNull();
    expect(result.generation.message).toBe("さっきからハンターハンターの話じゃない？");
  });

  it("話題が決まっている途中でも同じ（本作の場面に別の作品の名前を混ぜない）", async () => {
    mocks.detectOtherWork.mockResolvedValue(otherWork);
    const result = await runConversationPipeline({ ...params, history, userMessage, topic, currentEpisode: 60 });
    expect(result.directive.kind).toBe("other_work");
    expect(mocks.detectTopicShift).not.toHaveBeenCalled();
  });

  it("判定役が本作の話と見れば（null）、従来どおり話題を調べる", async () => {
    mocks.lookupSessionTopic.mockResolvedValue(null);
    const result = await runConversationPipeline({ ...params, history, userMessage });
    expect(mocks.lookupSessionTopic).toHaveBeenCalledTimes(1);
    expect(result.directive.kind).toBe("ask_scene");
  });

  it("としおは、別の作品の指摘・名前の聞き返しの回には割り込まない", async () => {
    const generation: GenerationResult = { message: "それ、HUNTER×HUNTERの話じゃない？", claims: [], strategy: "no_new_lie" };
    const analysis = { mentionedCharacters: [], mentionedEvents: [], sentiment: "positive", questionType: "fact_question" as const };
    for (const directive of [
      { kind: "other_work" as const, phase: "early" as const, otherWork: "HUNTER×HUNTER", names: ["ナックル"] },
      { kind: "confirm_name" as const, phase: "early" as const, corrections: [{ written: "ハコワレ", entity: "ハチワレ" }] },
    ]) {
      const result = await runToshioInterjection({ ...params, history, userMessage, analysis, generation, phase: "late", topic, currentEpisode: 60, directive });
      expect(result).toBeNull();
    }
    expect(mocks.generateToshioCommentary).not.toHaveBeenCalled();
  });
});

describe("2発話目（ルート2）: そうだった。間違えた。", () => {
  it("誤字も見知らぬ語も無いので plain。履歴（ハコワレ→ハチワレの確認）はそのままシオリに渡る", async () => {
    const history: Message[] = [
      { id: "u1", sessionId: "s1", role: "user", content: "草むしり検定はハコワレが頑張っていてとても良かった。", createdAt: "2026-09-16T00:00:00.000Z" },
      { id: "a1", sessionId: "s1", role: "assistant", speaker: "shiori", content: "ハコワレ？ ハチワレのこと？", createdAt: "2026-09-16T00:00:01.000Z" },
    ];
    mocks.generateReply.mockResolvedValue("確かにハチワレは草むしり検定で頑張っていたよね。");
    const result = await runConversationPipeline({ ...params, history, userMessage: "そうだった。間違えた。", topic, currentEpisode: 60 });
    expect(result.directive.kind).toBe("plain");
    expect(mocks.detectOtherWork).toHaveBeenCalledWith(expect.objectContaining({ unknownNames: [] }));
    expect(mocks.generateReply.mock.calls[0][0].history).toEqual(history);
    expect(mocks.extractClaims).toHaveBeenCalledTimes(1);
  });
});
