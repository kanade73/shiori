import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CanonFact, GenerationResult, Message, SessionTopic } from "../types";

// issue #14: 話題の場面が決まるまでは発話のたびに調べ、決まったら以後は調べないこと、
// 場面から分かった境界と事実が generate / evaluate に届くことを固定する。
// Gemini を叩く generate・topic と、data/ を読む works / retrieval は差し替え、evaluate は本物を通す。
const mocks = vi.hoisted(() => ({
  generateResponse: vi.fn(),
  lookupSessionTopic: vi.fn(),
  episodeBoundaryFor: vi.fn(),
  detectTopicShift: vi.fn(),
  retrieveCanonFacts: vi.fn(),
  retrieveFabricatedFacts: vi.fn(),
  getAllCanonFacts: vi.fn(),
}));
vi.mock("./generate", () => ({ generateResponse: mocks.generateResponse }));
vi.mock("./toshio", () => ({ generateToshioCommentary: vi.fn() }));
vi.mock("../topic", () => ({
  lookupSessionTopic: mocks.lookupSessionTopic,
  episodeBoundaryFor: mocks.episodeBoundaryFor,
  isSameTopic: (a: SessionTopic, b: SessionTopic) => a.title === b.title,
}));
vi.mock("../topic-shift", () => ({ detectTopicShift: mocks.detectTopicShift }));
vi.mock("../retrieval", () => ({
  retrieveCanonFacts: mocks.retrieveCanonFacts,
  retrieveFabricatedFacts: mocks.retrieveFabricatedFacts,
  getActiveFabricatedFacts: () => [],
  textIncludesAny: (text: string, needles: string[]) =>
    needles.some((n) => n.trim().length > 0 && text.toLowerCase().includes(n.toLowerCase())),
}));
vi.mock("../works", () => ({
  getAllCanonFacts: mocks.getAllCanonFacts,
  getEntities: () => [],
  getArcs: () => [],
  getEpisodesUpTo: () => [],
}));

import { historyForTopic, runConversationPipeline } from "./pipeline";

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
  return { message: "そうだね。", strategy: "no_new_lie", claims: [], ...overrides };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.lookupSessionTopic.mockResolvedValue(topic);
  mocks.episodeBoundaryFor.mockImplementation((_workId: string, t: SessionTopic | null) => (t ? 63 : 0));
  mocks.retrieveCanonFacts.mockImplementation((_w: string, _e: number, _a: unknown, facts: CanonFact[] = []) => facts);
  mocks.retrieveFabricatedFacts.mockReturnValue([]);
  mocks.getAllCanonFacts.mockReturnValue([workFact]);
  mocks.generateResponse.mockResolvedValue(generation());
  mocks.detectTopicShift.mockResolvedValue(null);
});

describe("runConversationPipeline: 話題の場面（issue #14）", () => {
  it("話題がまだ無ければ、この発話で調べ、決まった話題と境界を返す", async () => {
    const result = await runConversationPipeline(params);
    expect(mocks.lookupSessionTopic).toHaveBeenCalledWith({ workId: "w", workTitle: "テスト作品", userMessage: "検定のところ", ordinal: 1 });
    expect(result.newTopic).toBe(topic);
    expect(result.currentEpisode).toBe(63);
  });

  it("決まった話題の事実を本物の設定として取り出し、話題と境界ごとシオリに渡す", async () => {
    await runConversationPipeline(params);
    expect(mocks.retrieveCanonFacts).toHaveBeenCalledWith("w", 63, expect.anything(), [topicFact]);
    expect(mocks.generateResponse.mock.calls[0][0]).toMatchObject({ topic, currentEpisode: 63, canonFacts: [topicFact] });
  });

  it("既に話題が決まっていて、切り替わっていなければ調べ直さない", async () => {
    const result = await runConversationPipeline({ ...params, currentEpisode: 63, topic });
    expect(mocks.detectTopicShift).toHaveBeenCalledTimes(1);
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
});

function msg(overrides: Partial<Message>): Message {
  return { id: "m", sessionId: "s1", role: "user", content: "", createdAt: "2026-09-15T00:00:00.000Z", ...overrides };
}

const pajamaFact: CanonFact = { ...topicFact, id: "topic-2-1", episodeFrom: 144, subject: "パジャマパーティーズ", description: "4人組" };
const pajama: SessionTopic = {
  ...topic,
  title: "パジャマパーティーズ編",
  arcId: "arc-pajama",
  facts: [pajamaFact],
  query: "そういえばパジャマパーティーズも好き",
};

describe("runConversationPipeline: 話題の切り替わり", () => {
  const history = [
    msg({ id: "u1", content: "検定のところ", createdAt: "2026-09-15T00:00:01.000Z" }),
    msg({ id: "a1", role: "assistant", speaker: "shiori", content: "あの回ね。", createdAt: "2026-09-15T00:00:02.000Z" }),
  ];
  const shiftParams = {
    ...params,
    currentEpisode: 63,
    topic,
    history,
    userMessage: "そういえばパジャマパーティーズも好き",
    userMessageAt: "2026-09-15T00:00:03.000Z",
  };

  beforeEach(() => {
    mocks.detectTopicShift.mockResolvedValue({ query: "パジャマパーティーズ", signal: { reason: "cue", detail: "そういえば" } });
    mocks.lookupSessionTopic.mockResolvedValue(pajama);
    mocks.episodeBoundaryFor.mockImplementation((_w: string, t: SessionTopic | null) => (t?.arcId === "arc-pajama" ? 155 : t ? 63 : 0));
  });

  it("切り替わったと判定したら、組み直した検索語で引き直す（事実の id は2番目の話題として分ける）", async () => {
    await runConversationPipeline(shiftParams);
    expect(mocks.detectTopicShift).toHaveBeenCalledWith({
      workId: "w",
      workTitle: "テスト作品",
      topic,
      history,
      userMessage: "そういえばパジャマパーティーズも好き",
    });
    expect(mocks.lookupSessionTopic).toHaveBeenCalledWith({
      workId: "w",
      workTitle: "テスト作品",
      userMessage: "そういえばパジャマパーティーズも好き",
      query: "パジャマパーティーズ",
      ordinal: 2,
    });
  });

  it("新しい話題（切り替えの時刻つき）と前の話題を返し、境界を広げる", async () => {
    const result = await runConversationPipeline(shiftParams);
    expect(result.newTopic).toEqual({ ...pajama, since: "2026-09-15T00:00:03.000Z" });
    expect(result.previousTopic).toBe(topic);
    expect(result.currentEpisode).toBe(155);
  });

  it("シオリには切り替え後の履歴だけを渡し（この発話では空）、前の話題は名前だけ、事実は新しい話題の分だけを渡す", async () => {
    await runConversationPipeline(shiftParams);
    const args = mocks.generateResponse.mock.calls[0][0];
    expect(args.history).toEqual([]);
    expect(args.pastTopics).toEqual([topic]);
    expect(args.canonFacts).toEqual([pajamaFact]);
    expect(args.topic.title).toBe("パジャマパーティーズ編");
  });

  it("[企画の制約] 前の話題の事実に拠った主張も、ネタバレ・上書きの検査では引ける", async () => {
    const claim = {
      subject: "ハチワレ",
      relation: "did" as const,
      object: "検定に合格",
      negated: false,
      claim: "ハチワレは検定に合格した",
      grounding: "canon" as const,
      sourceCanonFactIds: ["topic-1"],
    };
    mocks.generateResponse.mockResolvedValue(generation({ claims: [claim] }));
    const result = await runConversationPipeline(shiftParams);
    expect(result.evaluation.shouldRegenerate).toBe(false);
  });

  it("引き直しても同じ場面なら、切り替えとみなさない", async () => {
    mocks.lookupSessionTopic.mockResolvedValue({ ...topic, query: "別の言い方" });
    const result = await runConversationPipeline(shiftParams);
    expect(result.newTopic).toBeNull();
    expect(result.previousTopic).toBeNull();
    expect(mocks.generateResponse.mock.calls[0][0].history).toEqual(history);
  });

  it("引き直して特定できなければ、いまの話題のまま続ける", async () => {
    mocks.lookupSessionTopic.mockResolvedValue(null);
    const result = await runConversationPipeline(shiftParams);
    expect(result.newTopic).toBeNull();
    expect(mocks.generateResponse.mock.calls[0][0].topic).toBe(topic);
  });

  it("切り替わっていなければ（判定が null）引き直さない", async () => {
    mocks.detectTopicShift.mockResolvedValue(null);
    await runConversationPipeline(shiftParams);
    expect(mocks.lookupSessionTopic).not.toHaveBeenCalled();
  });

  it("前にも切り替えがあれば、話題の番号は続きから（3番目）", async () => {
    await runConversationPipeline({ ...shiftParams, pastTopics: [{ ...topic, title: "最初の話題" }] });
    expect(mocks.lookupSessionTopic.mock.calls[0][0].ordinal).toBe(3);
  });
});

describe("historyForTopic: 話題の切り替え後の履歴だけを残す", () => {
  const history = [
    msg({ id: "old", createdAt: "2026-09-15T00:00:01.000Z" }),
    msg({ id: "shift", createdAt: "2026-09-15T00:00:03.000Z" }),
    msg({ id: "after", role: "assistant", createdAt: "2026-09-15T00:00:04.000Z" }),
  ];

  it("切り替えのきっかけの発話（since と同じ時刻）から後を残す", () => {
    expect(historyForTopic(history, { ...topic, since: "2026-09-15T00:00:03.000Z" }).map((m) => m.id)).toEqual(["shift", "after"]);
  });

  it("最初の話題（since なし）や話題なしでは何も落とさない", () => {
    expect(historyForTopic(history, topic)).toBe(history);
    expect(historyForTopic(history, null)).toBe(history);
  });
});
