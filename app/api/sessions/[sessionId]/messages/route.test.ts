import { beforeEach, describe, expect, it, vi } from "vitest";
import { readSse, type SseEvent } from "@/lib/client/sse";

// SSE の契約（message-start / token / metadata / message-end / done の並び）と、
// としおの発話が speaker 付きで保存されること、クライアント切断後に
// enqueue-after-close で落ちないことを固定する。パイプラインと永続化は差し替える。
const mocks = vi.hoisted(() => ({
  runConversationPipeline: vi.fn(),
  runToshioInterjection: vi.fn(),
  appendMessage: vi.fn(),
  addFabricatedFact: vi.fn(),
  saveMessageClaims: vi.fn(),
  setSessionTopic: vi.fn(),
  getMessages: vi.fn(),
  getSession: vi.fn(),
  getWork: vi.fn(),
  isRateLimited: vi.fn(),
}));
vi.mock("@/lib/server/llm/pipeline", () => ({
  runConversationPipeline: mocks.runConversationPipeline,
  runToshioInterjection: mocks.runToshioInterjection,
  fallbackMessage: () => "……ちょっと分からなくなった。もう一度言って。",
}));
vi.mock("@/lib/server/store", () => ({
  appendMessage: mocks.appendMessage,
  addFabricatedFact: mocks.addFabricatedFact,
  saveMessageClaims: mocks.saveMessageClaims,
  setSessionTopic: mocks.setSessionTopic,
  getMessages: mocks.getMessages,
  getSession: mocks.getSession,
}));
vi.mock("@/lib/server/works", () => ({ getWork: mocks.getWork }));
vi.mock("@/lib/server/rate-limit", () => ({ isRateLimited: mocks.isRateLimited }));

import { POST } from "./route";

const SHIORI = "そうだね。多分ね。";
const TOSHIO = "結論から言うとね、あれは伏線なんですよ。";

function pipelineResult(overrides: Record<string, unknown> = {}) {
  return {
    analysis: { mentionedCharacters: [], mentionedEvents: [], sentiment: "neutral", questionType: "theory" },
    generation: { message: SHIORI, strategy: "introduce_small_lie", claims: [] },
    evaluation: {
      canonContradictionScore: 0,
      fabricatedConsistencyScore: 1,
      believabilityScore: 0.85,
      shouldRegenerate: false,
      details: [],
    },
    regenerated: false,
    newFabricatedClaims: [],
    reusedFabricatedFactIds: [],
    newTopic: null,
    currentEpisode: 3,
    ...overrides,
  };
}

function post(content = "これって伏線じゃない？") {
  const req = new Request("http://localhost/api/sessions/s1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content }),
  });
  return POST(req, { params: Promise.resolve({ sessionId: "s1" }) });
}

async function collect(res: Response): Promise<SseEvent[]> {
  const events: SseEvent[] = [];
  for await (const ev of readSse(res)) events.push(ev);
  return events;
}

/** message-start ごとに token を連結し、[speaker, 本文] の並びに畳む */
function bubbles(events: SseEvent[]): [string, string][] {
  const out: [string, string][] = [];
  for (const { event, data } of events) {
    if (event === "message-start") out.push([(data as { speaker: string }).speaker, ""]);
    else if (event === "token") out[out.length - 1][1] += (data as { text: string }).text;
  }
  return out;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getSession.mockReturnValue({ id: "s1", workId: "w", currentEpisode: 3, createdAt: "", updatedAt: "" });
  mocks.getWork.mockReturnValue({ id: "w", title: "テスト作品", createdAt: "" });
  mocks.getMessages.mockReturnValue([]);
  mocks.isRateLimited.mockReturnValue(false);
  let n = 0;
  mocks.appendMessage.mockImplementation((sessionId: string, role: string, content: string, speaker?: string) => ({
    id: `msg-${++n}`,
    sessionId,
    role,
    content,
    createdAt: "",
    ...(speaker ? { speaker } : {}),
  }));
  mocks.addFabricatedFact.mockImplementation(() => ({ id: "ff-new" }));
  mocks.runConversationPipeline.mockResolvedValue(pipelineResult());
  mocks.runToshioInterjection.mockResolvedValue(TOSHIO);
});

describe("POST /api/sessions/[id]/messages: 1回の送信でシオリ→としおを順に流す", () => {
  it("message-start(shiori) … message-end, message-start(toshio) … message-end, done の順で届く", async () => {
    const events = await collect(await post());
    const kinds = events.map((e) => e.event).filter((e) => e !== "token");
    expect(kinds).toEqual(["message-start", "metadata", "message-end", "message-start", "metadata", "message-end", "done"]);
    expect(bubbles(events)).toEqual([
      ["shiori", SHIORI],
      ["toshio", TOSHIO],
    ]);
  });

  it("シオリは speaker=shiori、としおは speaker=toshio で保存される（ユーザー発言の後、この順）", async () => {
    await collect(await post("これって伏線じゃない？"));
    expect(mocks.appendMessage.mock.calls).toEqual([
      ["s1", "user", "これって伏線じゃない？"],
      ["s1", "assistant", SHIORI, "shiori"],
      ["s1", "assistant", TOSHIO, "toshio"],
    ]);
  });

  it("としおの metadata には嘘の ID を付けない（としおの発話は FabricatedFact 化していない）", async () => {
    mocks.runConversationPipeline.mockResolvedValue(
      pipelineResult({
        newFabricatedClaims: [
          { subject: "A", relation: "has", object: "帽子", negated: false, claim: "A は帽子を持っている", grounding: "fabricated", sourceCanonFactIds: [] },
        ],
        reusedFabricatedFactIds: ["ff-old"],
      }),
    );
    const events = await collect(await post());
    const metadata = events.filter((e) => e.event === "metadata").map((e) => e.data as { fabricatedFactIds: string[] });
    expect(metadata[0].fabricatedFactIds).toEqual(["ff-new", "ff-old"]);
    expect(metadata[1].fabricatedFactIds).toEqual([]);
    // 嘘はシオリの発話に紐づく
    expect(mocks.addFabricatedFact.mock.calls[0][0].introducedMessageId).toBe("msg-2");
  });

  it("としおはシオリの発話を保存し終えてから、同じ材料（履歴・分析・生成結果）で呼ぶ", async () => {
    mocks.runToshioInterjection.mockImplementation(async () => {
      // 呼ばれた時点でシオリの発話は保存済み
      expect(mocks.appendMessage).toHaveBeenCalledWith("s1", "assistant", SHIORI, "shiori");
      return TOSHIO;
    });
    const pipeline = pipelineResult();
    mocks.runConversationPipeline.mockResolvedValue(pipeline);
    await collect(await post("これって伏線じゃない？"));
    expect(mocks.runToshioInterjection).toHaveBeenCalledWith({
      workId: "w",
      workTitle: "テスト作品",
      sessionId: "s1",
      currentEpisode: 3,
      topic: undefined,
      history: [],
      userMessage: "これって伏線じゃない？",
      analysis: pipeline.analysis,
      generation: pipeline.generation,
    });
  });

  it("としおが割り込まなければ（null）吹き出しはシオリの1つだけ", async () => {
    mocks.runToshioInterjection.mockResolvedValue(null);
    const events = await collect(await post());
    expect(bubbles(events)).toEqual([["shiori", SHIORI]]);
    expect(mocks.appendMessage).toHaveBeenCalledTimes(2);
    expect(events[events.length - 1].event).toBe("done");
  });

  it("パイプラインが失敗したら定型文をシオリとして流して保存し、としおは呼ばない", async () => {
    mocks.runConversationPipeline.mockRejectedValue(new Error("boom"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const events = await collect(await post());
    spy.mockRestore();
    expect(mocks.runToshioInterjection).not.toHaveBeenCalled();
    expect(bubbles(events)).toEqual([["shiori", "……ちょっと分からなくなった。もう一度言って。"]]);
    expect(events.map((e) => e.event).filter((e) => e !== "token")).toEqual(["message-start", "metadata", "message-end", "done"]);
    expect(mocks.appendMessage).toHaveBeenLastCalledWith("s1", "assistant", "……ちょっと分からなくなった。もう一度言って。", "shiori");
  });
});

describe("POST /api/sessions/[id]/messages: 答え合わせ用の記録", () => {
  it("シオリの返答の claims を、その発話の ID で真偽ごと保存する（としおの発話には保存しない）", async () => {
    const claims = [
      { subject: "A", relation: "has", object: "帽子", negated: false, claim: "A は帽子を持っている", grounding: "fabricated", sourceCanonFactIds: [], quote: "多分ね" },
      { subject: "A", relation: "is", object: "友達", negated: false, claim: "A は友達", grounding: "canon", sourceCanonFactIds: ["c1"], quote: "そうだね" },
    ];
    mocks.runConversationPipeline.mockResolvedValue(
      pipelineResult({ generation: { message: SHIORI, strategy: "introduce_small_lie", claims } }),
    );
    await collect(await post());
    expect(mocks.saveMessageClaims.mock.calls).toEqual([["s1", "msg-2", claims]]);
  });

  it("定型文にも「主張なし」を記録する（記録前の旧データと区別するため）", async () => {
    mocks.runConversationPipeline.mockRejectedValue(new Error("boom"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await collect(await post());
    spy.mockRestore();
    expect(mocks.saveMessageClaims.mock.calls).toEqual([["s1", "msg-2", []]]);
  });

  it("答え合わせ済みのセッションには送れない（409）", async () => {
    mocks.getSession.mockReturnValue({
      id: "s1",
      workId: "w",
      currentEpisode: 3,
      createdAt: "",
      updatedAt: "",
      reveal: { revealedAt: "2026-09-14T00:00:00.000Z", guesses: {} },
    });
    const res = await post();
    expect(res.status).toBe(409);
    expect(mocks.appendMessage).not.toHaveBeenCalled();
    expect(mocks.runConversationPipeline).not.toHaveBeenCalled();
  });
});

describe("POST /api/sessions/[id]/messages: 話題の場面（issue #14）", () => {
  const topic = {
    title: "草むしり検定編",
    summary: "ちいかわとハチワレが検定を受ける。",
    arcId: "arc-kentei",
    facts: [],
    sources: [{ title: "記事", url: "https://example.org/wiki/記事" }],
    query: "検定のところ",
    resolvedAt: "2026-09-15T00:00:00.000Z",
  };

  it("セッションの話題をパイプラインに渡し、この発話で決まった話題と境界を保存して topic イベントで知らせる", async () => {
    mocks.runConversationPipeline.mockResolvedValue(pipelineResult({ newTopic: topic, currentEpisode: 63 }));
    const events = await collect(await post("検定のところ"));
    expect(mocks.runConversationPipeline.mock.calls[0][0].topic).toBeUndefined();
    expect(mocks.setSessionTopic).toHaveBeenCalledWith("s1", topic, 63);
    expect(events.find((e) => e.event === "topic")?.data).toEqual(topic);
    // topic はシオリの吹き出しより前に届く（ヘッダーを先に更新できる）
    expect(events[0].event).toBe("topic");
    // としおにも決まった話題と境界を渡す
    expect(mocks.runToshioInterjection.mock.calls[0][0]).toMatchObject({ topic, currentEpisode: 63 });
  });

  it("話題が切り替わったら、切り替え先を保存・通知し、としおにも切り替え先を渡す", async () => {
    const next = { ...topic, title: "パジャマパーティーズ編", since: "2026-09-15T00:00:03.000Z" };
    mocks.getSession.mockReturnValue({ id: "s1", workId: "w", currentEpisode: 63, topic, pastTopics: [], createdAt: "", updatedAt: "" });
    mocks.runConversationPipeline.mockResolvedValue(pipelineResult({ newTopic: next, previousTopic: topic, currentEpisode: 155 }));
    const events = await collect(await post("そういえばパジャマパーティーズも"));
    expect(mocks.setSessionTopic).toHaveBeenCalledWith("s1", next, 155);
    expect(events.find((e) => e.event === "topic")?.data).toEqual(next);
    expect(mocks.runToshioInterjection.mock.calls[0][0].topic).toEqual(next);
  });

  it("パイプラインには前の話題と、今回のユーザー発話の保存時刻（履歴を切る基準）を渡す", async () => {
    const past = [{ ...topic, title: "前の話題" }];
    mocks.getSession.mockReturnValue({ id: "s1", workId: "w", currentEpisode: 63, topic, pastTopics: past, createdAt: "", updatedAt: "" });
    mocks.appendMessage.mockImplementationOnce((sessionId: string, role: string, content: string) => ({
      id: "msg-user",
      sessionId,
      role,
      content,
      createdAt: "2026-09-15T00:00:09.000Z",
    }));
    await collect(await post());
    expect(mocks.runConversationPipeline.mock.calls[0][0]).toMatchObject({ pastTopics: past, userMessageAt: "2026-09-15T00:00:09.000Z" });
  });

  it("既に話題が決まっていれば、それを渡し、保存し直さず、topic イベントも出さない", async () => {
    mocks.getSession.mockReturnValue({ id: "s1", workId: "w", currentEpisode: 63, topic, createdAt: "", updatedAt: "" });
    mocks.runConversationPipeline.mockResolvedValue(pipelineResult({ currentEpisode: 63 }));
    const events = await collect(await post());
    expect(mocks.runConversationPipeline.mock.calls[0][0].topic).toEqual(topic);
    expect(mocks.setSessionTopic).not.toHaveBeenCalled();
    expect(events.some((e) => e.event === "topic")).toBe(false);
    expect(mocks.runToshioInterjection.mock.calls[0][0].topic).toEqual(topic);
  });
});

describe("POST /api/sessions/[id]/messages: クライアント切断（enqueue-after-close）", () => {
  it("途中で切断されても例外にせず、シオリ・としおの発話は最後まで保存される", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await post();
    const reader = res.body!.getReader();
    await reader.read(); // 最初のフレーム（message-start）だけ受け取って
    await reader.cancel(); // タブを閉じたことにする

    await vi.waitFor(() => expect(mocks.appendMessage).toHaveBeenCalledWith("s1", "assistant", TOSHIO, "toshio"));
    expect(mocks.appendMessage).toHaveBeenCalledWith("s1", "assistant", SHIORI, "shiori");
    // 切断は pipeline の失敗ではないので、フォールバックの定型文は保存されない
    expect(mocks.appendMessage).toHaveBeenCalledTimes(3);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
