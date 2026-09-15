import { beforeEach, describe, expect, it, vi } from "vitest";
import { readSse, type SseEvent } from "@/lib/client/sse";
import { emitPipelineEvent } from "@/lib/server/events";
import type { FabricatedFact, Message } from "@/lib/server/types";

/**
 * 開発者モードのパネル専用 SSE。接続時に今の状態（init）を送り、パイプラインの各段を
 * そのまま中継し、嘘が保存されたときだけグラフを描き直すことを固定する。永続化と data/ は差し替える。
 */
const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  getMessages: vi.fn(),
  getFabricatedFacts: vi.fn(),
  getEntities: vi.fn(),
}));
vi.mock("@/lib/server/store", () => ({
  getSession: mocks.getSession,
  getMessages: mocks.getMessages,
  getFabricatedFacts: mocks.getFabricatedFacts,
}));
vi.mock("@/lib/server/works", () => ({ getEntities: mocks.getEntities }));

import { GET } from "./route";

const SESSION_ID = "dev-events-s1";

function fact(overrides: Partial<FabricatedFact> = {}): FabricatedFact {
  return {
    id: "ff-1",
    sessionId: SESSION_ID,
    subject: "A",
    relation: "has",
    object: "赤い帽子",
    negated: false,
    claim: "A は赤い帽子を持っている",
    sourceCanonFactIds: [],
    introducedMessageId: "m1",
    confidence: 0.9,
    status: "active",
    createdAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function userMessage(id: string): Message {
  return { id, sessionId: SESSION_ID, role: "user", content: "……", createdAt: "2026-01-01T00:00:00Z" };
}

/**
 * 接続し、引数のイベントを流してから閉じる。届いた SSE を全部返す。
 * このストリームは（購読している間は）閉じないので、読めるものが尽きたら打ち切る。
 */
async function connectAndEmit(emits: (() => void)[]): Promise<SseEvent[]> {
  const res = await GET(new Request("http://localhost/api/sessions/x/events"), {
    params: Promise.resolve({ sessionId: SESSION_ID }),
  });
  for (const e of emits) e();

  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const chunk = await Promise.race([
      reader.read().then((r) => r.value),
      new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), 5)),
    ]);
    if (!chunk) break;
    buffer += decoder.decode(chunk, { stream: true });
  }
  await reader.cancel();

  const events: SseEvent[] = [];
  for await (const ev of readSse(new Response(buffer))) events.push(ev);
  return events;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getSession.mockReturnValue({ id: SESSION_ID, workId: "w", currentEpisode: 3, createdAt: "", updatedAt: "" });
  mocks.getMessages.mockReturnValue([userMessage("m1"), userMessage("m2")]);
  mocks.getFabricatedFacts.mockReturnValue([fact()]);
  mocks.getEntities.mockReturnValue([{ id: "e1", workId: "w", name: "A", aliases: [] }]);
});

describe("GET /api/sessions/[sessionId]/events", () => {
  it("知らないセッションは 404", async () => {
    mocks.getSession.mockReturnValue(null);
    const res = await GET(new Request("http://localhost/x"), { params: Promise.resolve({ sessionId: "nope" }) });
    expect(res.status).toBe(404);
  });

  it("text/event-stream を返す", async () => {
    const res = await GET(new Request("http://localhost/x"), { params: Promise.resolve({ sessionId: SESSION_ID }) });
    expect(res.headers.get("Content-Type")).toBe("text/event-stream");
    await res.body?.cancel();
  });

  it("接続した時点の進行度・上限・嘘の件数・グラフを init として送る", async () => {
    const events = await connectAndEmit([]);
    const init = events.find((e) => e.event === "init")!;
    expect(init).toBeDefined();
    const data = init.data as {
      phase: string;
      limits: { lieStreakLimit: number | null; layerDetailCount: number; toshioCooldownTurns: number };
      fabricatedFactCount: number;
      graph: { nodes: { kind: string }[] };
    };
    expect(data.phase).toBe("early");
    expect(data.limits).toEqual({ lieStreakLimit: 2, layerDetailCount: 1, toshioCooldownTurns: 2 });
    expect(data.fabricatedFactCount).toBe(1);
    expect(data.graph.nodes.filter((n) => n.kind === "statement")).toHaveLength(1);
  });

  it("嘘が積み上がっていれば init の進行度が late になり、連続嘘の上限は「なし」（null）になる", async () => {
    mocks.getFabricatedFacts.mockReturnValue(Array.from({ length: 9 }, (_, i) => fact({ id: `ff-${i}` })));
    const events = await connectAndEmit([]);
    const data = events.find((e) => e.event === "init")!.data as { phase: string; limits: { lieStreakLimit: number | null } };
    expect(data.phase).toBe("late");
    expect(data.limits.lieStreakLimit).toBeNull();
  });

  it("パイプラインの各段をそのまま stage として中継する", async () => {
    const events = await connectAndEmit([
      () =>
        emitPipelineEvent(SESSION_ID, {
          turnId: "t1",
          at: "2026-01-01T00:00:00Z",
          stage: "analyze",
          mentionedCharacters: ["A"],
          mentionedEvents: [],
          questionType: "theory",
        }),
      () =>
        emitPipelineEvent(SESSION_ID, {
          turnId: "t1",
          at: "2026-01-01T00:00:01Z",
          stage: "evaluate",
          attempt: 1,
          flagged: false,
          details: [],
        }),
    ]);

    const stages = events.filter((e) => e.event === "stage").map((e) => (e.data as { stage: string }).stage);
    expect(stages).toEqual(["analyze", "evaluate"]);
  });

  it("嘘が保存された（saved）ときだけ、描き直したグラフと増えたノードを graph として足す", async () => {
    const events = await connectAndEmit([
      () =>
        emitPipelineEvent(SESSION_ID, {
          turnId: "t1",
          at: "2026-01-01T00:00:00Z",
          stage: "saved",
          newFactIds: ["ff-1"],
          strategy: "introduce_small_lie",
          phase: "early",
        }),
    ]);

    const graph = events.find((e) => e.event === "graph");
    expect(graph).toBeDefined();
    const data = graph!.data as { newFactIds: string[]; graph: { nodes: unknown[] }; fabricatedFactCount: number };
    expect(data.newFactIds).toEqual(["ff-1"]);
    expect(data.fabricatedFactCount).toBe(1);
    expect(data.graph.nodes.length).toBeGreaterThan(0);
  });

  it("saved 以外では graph を送らない（描き直しは保存のときだけ）", async () => {
    const events = await connectAndEmit([
      () => emitPipelineEvent(SESSION_ID, { turnId: "t1", at: "2026-01-01T00:00:00Z", stage: "fallback" }),
    ]);
    expect(events.some((e) => e.event === "graph")).toBe(false);
  });

  it("[他のセッションを覗かない] 別セッションのイベントは中継しない", async () => {
    const events = await connectAndEmit([
      () => emitPipelineEvent("other-session", { turnId: "t1", at: "2026-01-01T00:00:00Z", stage: "fallback" }),
    ]);
    expect(events.filter((e) => e.event === "stage")).toHaveLength(0);
  });
});
