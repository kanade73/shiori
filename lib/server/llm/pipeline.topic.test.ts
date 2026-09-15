import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CanonFact, GenerationResult, SessionTopic } from "../types";

// issue #14: 話題の場面が決まるまでは発話のたびに調べ、決まったら以後は調べないこと、
// 場面から分かった境界と事実が generate / evaluate に届くことを固定する。
// Gemini を叩く generate・topic と、data/ を読む works / retrieval は差し替え、evaluate は本物を通す。
const mocks = vi.hoisted(() => ({
  generateResponse: vi.fn(),
  lookupSessionTopic: vi.fn(),
  episodeBoundaryFor: vi.fn(),
  retrieveCanonFacts: vi.fn(),
  retrieveFabricatedFacts: vi.fn(),
  getAllCanonFacts: vi.fn(),
}));
vi.mock("./generate", () => ({ generateResponse: mocks.generateResponse }));
vi.mock("./toshio", () => ({ generateToshioCommentary: vi.fn() }));
vi.mock("../topic", () => ({
  lookupSessionTopic: mocks.lookupSessionTopic,
  episodeBoundaryFor: mocks.episodeBoundaryFor,
}));
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

const topicFact: CanonFact = {
  id: "topic-1",
  workId: "w",
  episodeFrom: 57,
  subject: "ハチワレ",
  relation: "did",
  object: "検定に合格",
  description: "ハチワレは検定に合格した。",
};
const topic: SessionTopic = {
  title: "草むしり検定編",
  summary: "検定の話。",
  arcId: "arc-kentei",
  facts: [topicFact],
  sources: [],
  query: "検定のところ",
  resolvedAt: "2026-09-15T00:00:00.000Z",
};
/** work.json の設定。第60話で明かされる */
const workFact: CanonFact = { ...topicFact, id: "cf-60", episodeFrom: 60, description: "第60話の事実" };

const params = {
  workId: "w",
  workTitle: "テスト作品",
  sessionId: "s1",
  currentEpisode: 0,
  history: [],
  userMessage: "検定のところ",
};

function generation(overrides: Partial<GenerationResult> = {}): GenerationResult {
  return { message: "そうだね。", strategy: "no_new_lie", claims: [], usedExistingFactIds: [], spoilerRisk: 0, ...overrides };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.lookupSessionTopic.mockResolvedValue(topic);
  mocks.episodeBoundaryFor.mockImplementation((_workId: string, t: SessionTopic | null) => (t ? 63 : 0));
  mocks.retrieveCanonFacts.mockImplementation((_w: string, _e: number, _a: unknown, facts: CanonFact[] = []) => facts);
  mocks.retrieveFabricatedFacts.mockReturnValue([]);
  mocks.getAllCanonFacts.mockReturnValue([workFact]);
  mocks.generateResponse.mockResolvedValue(generation());
});

describe("runConversationPipeline: 話題の場面（issue #14）", () => {
  it("話題がまだ無ければ、この発話で調べ、決まった話題と境界を返す", async () => {
    const result = await runConversationPipeline(params);
    expect(mocks.lookupSessionTopic).toHaveBeenCalledWith({ workId: "w", workTitle: "テスト作品", userMessage: "検定のところ" });
    expect(result.newTopic).toBe(topic);
    expect(result.currentEpisode).toBe(63);
  });

  it("決まった話題の事実を本物の設定として取り出し、話題と境界ごとシオリに渡す", async () => {
    await runConversationPipeline(params);
    expect(mocks.retrieveCanonFacts).toHaveBeenCalledWith("w", 63, expect.anything(), [topicFact]);
    expect(mocks.generateResponse.mock.calls[0][0]).toMatchObject({ topic, currentEpisode: 63, canonFacts: [topicFact] });
  });

  it("既に話題が決まっていれば調べ直さない", async () => {
    const result = await runConversationPipeline({ ...params, currentEpisode: 63, topic });
    expect(mocks.lookupSessionTopic).not.toHaveBeenCalled();
    expect(result.newTopic).toBeNull();
    expect(mocks.generateResponse.mock.calls[0][0].topic).toBe(topic);
  });

  it("特定できなければ話題なしのまま返事をする（境界は動かない）", async () => {
    mocks.lookupSessionTopic.mockResolvedValue(null);
    const result = await runConversationPipeline(params);
    expect(result.newTopic).toBeNull();
    expect(result.currentEpisode).toBe(0);
    expect(mocks.generateResponse.mock.calls[0][0]).toMatchObject({ topic: null, currentEpisode: 0 });
  });

  it("境界は狭めない（保存済みの境界の方が先なら、そちらを使う）", async () => {
    const result = await runConversationPipeline({ ...params, currentEpisode: 80, topic });
    expect(result.currentEpisode).toBe(80);
  });

  it("[企画の制約] 話題から分かった境界で evaluate する: 境界内の設定に拠った主張はネタバレ扱いしない", async () => {
    const claim = {
      subject: "ハチワレ",
      relation: "did" as const,
      object: "検定に合格",
      negated: false,
      claim: "ハチワレは検定に合格した",
      grounding: "canon" as const,
      sourceCanonFactIds: ["cf-60", "topic-1"],
    };
    mocks.generateResponse.mockResolvedValue(generation({ claims: [claim] }));
    const result = await runConversationPipeline(params);
    expect(result.evaluation.shouldRegenerate).toBe(false);
    expect(result.regenerated).toBe(false);
  });

  it("[企画の制約] 話題が決まらないうちは、work.json の設定に拠った主張はネタバレとして差し戻す", async () => {
    mocks.lookupSessionTopic.mockResolvedValue(null);
    const claim = {
      subject: "ハチワレ",
      relation: "did" as const,
      object: "検定に合格",
      negated: false,
      claim: "ハチワレは検定に合格した",
      grounding: "canon" as const,
      sourceCanonFactIds: ["cf-60"],
    };
    mocks.generateResponse.mockResolvedValue(generation({ claims: [claim] }));
    const result = await runConversationPipeline(params);
    expect(result.regenerated).toBe(true);
    expect(mocks.generateResponse.mock.calls[1][0].feedback).toContain("第60話以降");
  });
});
