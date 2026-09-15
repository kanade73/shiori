import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Arc, Message, SessionTopic, SourceChunk } from "./types";

// 話題の切り替わりの判定。ゲート（決定的）は本物を通し、判定役（Gemini）と外部資料の取得は差し替える
const mocks = vi.hoisted(() => ({
  getSources: vi.fn(),
  getArcs: vi.fn(),
  getEntities: vi.fn(),
  loadSourceChunks: vi.fn(),
  routeTopicShift: vi.fn(),
}));
vi.mock("./works", () => ({
  getSources: mocks.getSources,
  getArcs: mocks.getArcs,
  getEntities: mocks.getEntities,
  getWork: () => null,
}));
vi.mock("./sources", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./sources")>()),
  loadSourceChunks: mocks.loadSourceChunks,
}));
vi.mock("./llm/router", () => ({ routeTopicShift: mocks.routeTopicShift }));
vi.mock("./llm/topic", () => ({ extractTopic: vi.fn() }));
vi.mock("./embeddings", () => ({ rankChunksByVector: vi.fn() }));

import { detectShiftSignal, detectTopicShift } from "./topic-shift";
import { rankChunks } from "./sources";

const kenteiArc: Arc = { id: "arc-kentei", workId: "w", title: "草むしり検定編", episodeFrom: 57, episodeTo: 63, aliases: ["検定編"] };
const pajamaArc: Arc = {
  id: "arc-pajama",
  workId: "w",
  title: "パジャマパーティーズ編",
  episodeFrom: 144,
  episodeTo: 155,
  aliases: ["パジャマパーティーズ"],
};

function chunk(overrides: Partial<SourceChunk>): SourceChunk {
  return { id: "c", sourceTitle: "記事", url: "u", heading: "連作エピソード", label: "", text: "", ...overrides };
}

const chunks = [
  chunk({ id: "kentei", label: "『草むしり検定』編", text: "ちいかわとハチワレが草むしり検定を受ける。合格したのはハチワレだけ。" }),
  chunk({ id: "ribbon", label: "『ほめられリボン』編", text: "ハチワレが大事にしていたリボンが鳥に持っていかれてしまう。" }),
  chunk({ id: "yoroi", heading: "登場キャラクター", label: "草の鎧さん", text: "草むしり検定の受付をしている鎧さん。" }),
];

const topic: SessionTopic = {
  title: "『草むしり検定』編",
  summary: "ちいかわとハチワレが検定を受ける。",
  arcId: "arc-kentei",
  facts: [],
  sources: [],
  chunkIds: ["kentei"],
  query: "検定のところ",
  resolvedAt: "",
};

function signal(userMessage: string, t: SessionTopic = topic) {
  return detectShiftSignal({ workId: "w", topic: t, userMessage, ranked: rankChunks(userMessage, chunks) });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getSources.mockReturnValue([{ kind: "mediawiki", endpoint: "e", page: "p" }]);
  mocks.getArcs.mockReturnValue([kenteiArc, pajamaArc]);
  mocks.getEntities.mockReturnValue([]);
  mocks.loadSourceChunks.mockResolvedValue(chunks);
  mocks.routeTopicShift.mockResolvedValue({ shift: true, query: "ほめられリボン" });
});

describe("detectShiftSignal: API を呼ばないゲート", () => {
  it("話題を変える言い回しがあれば疑う", () => {
    expect(signal("そういえば別の回も好き")).toEqual({ reason: "cue", detail: "そういえば" });
    expect(signal("次はモモンガの話がしたい")?.reason).toBe("cue");
    expect(signal("みんなで大きい敵を倒しにいく話ってあったよね")?.reason).toBe("cue");
    expect(signal("ループする回って結局どうなったの")?.reason).toBe("cue");
  });

  it("いまと別の arc の名前が出てきたら疑う（いまの arc なら疑わない）", () => {
    expect(signal("パジャマパーティーズのダンスよかった")).toEqual({ reason: "arc", detail: "パジャマパーティーズ編" });
    expect(signal("検定編のあの場面よかった")).toBeNull();
  });

  it("いまの話題の外の段落に強く重なったら疑う", () => {
    expect(signal("リボンが鳥に持っていかれるやつ")).toEqual({ reason: "chunk", detail: "『ほめられリボン』編" });
  });

  it("いまの話題の段落に重なる続きの発話・短い相づちでは疑わない", () => {
    expect(signal("ハチワレだけ合格したのなんで？")).toBeNull();
    expect(signal("それ本当？")).toBeNull();
    expect(signal("かわいいよね")).toBeNull();
  });

  it("旧データ（段落を覚えていない話題）では、段落の重なりでは判定しない", () => {
    expect(signal("リボンが鳥に持っていかれるやつ", { ...topic, chunkIds: undefined })).toBeNull();
  });
});

describe("detectTopicShift: ゲートを通った発話だけ判定役に聞く", () => {
  const history: Message[] = [
    { id: "a", sessionId: "s", role: "assistant", speaker: "shiori", content: "あの検定の回ね。", createdAt: "" },
    { id: "t", sessionId: "s", role: "assistant", speaker: "toshio", content: "結論から言うとね", createdAt: "" },
  ];
  const run = (userMessage: string) => detectTopicShift({ workId: "w", workTitle: "テスト作品", topic, history, userMessage });

  it("ゲートで落ちた発話では判定役（API）を呼ばない", async () => {
    expect(await run("ハチワレだけ合格したのなんで？")).toBeNull();
    expect(mocks.routeTopicShift).not.toHaveBeenCalled();
  });

  it("判定役には小さな文脈だけを渡す: いまの話題・直前のシオリの返答・発話・近い段落の見出し（本文は渡さない）", async () => {
    await run("リボンが鳥に持っていかれるやつ");
    const args = mocks.routeTopicShift.mock.calls[0][0];
    expect(args).toMatchObject({ workTitle: "テスト作品", topic, lastReply: "あの検定の回ね。", userMessage: "リボンが鳥に持っていかれるやつ" });
    expect(args.candidateLabels[0]).toBe("『ほめられリボン』編");
    expect(JSON.stringify(args)).not.toContain("大事にしていたリボン");
  });

  it("判定役が切り替えと言えば、組み直した検索語を返す", async () => {
    expect(await run("リボンが鳥に持っていかれるやつ")).toEqual({
      query: "ほめられリボン",
      signal: { reason: "chunk", detail: "『ほめられリボン』編" },
    });
  });

  it("判定役が続きと言えば null", async () => {
    mocks.routeTopicShift.mockResolvedValue({ shift: false, query: "" });
    expect(await run("そういえばハチワレって何級？")).toBeNull();
  });

  it("判定役の失敗は例外にせず null（いまの話題のまま続ける）", async () => {
    mocks.routeTopicShift.mockRejectedValue(new Error("429"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await run("リボンが鳥に持っていかれるやつ")).toBeNull();
    spy.mockRestore();
  });

  it("外部の知識源が無い作品では判定しない", async () => {
    mocks.getSources.mockReturnValue([]);
    expect(await run("そういえば別の回")).toBeNull();
    expect(mocks.routeTopicShift).not.toHaveBeenCalled();
  });
});
