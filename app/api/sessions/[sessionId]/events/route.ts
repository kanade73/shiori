import { NextResponse } from "next/server";
import { getFabricatedFacts, getMessages, getSession } from "@/lib/server/store";
import {
  subscribePipelineEvents,
  type DevEventsGraph,
  type DevEventsInit,
  type PipelineEvent,
} from "@/lib/server/events";
import { decideSessionPhase, phaseLimits } from "@/lib/server/llm/directive";
import { buildLieGraph } from "@/lib/server/lie-graph";
import { createSseWriter, SSE_HEADERS, type SseWriter } from "@/lib/server/sse";

/**
 * 開発者モードのパネル専用の SSE。パイプラインが各段で流す in-process イベントを
 * そのまま中継する。チャットの SSE（messages）とは別口で、会話の見た目には影響しない。
 *
 * 接続した時点の進行度と嘘のグラフを init として送り、以降は stage イベント。
 * 嘘が保存された（stage=saved）ときだけグラフを描き直して graph イベントを足す。
 */

const HEARTBEAT_MS = 25_000;

function snapshot(sessionId: string, workId: string) {
  const facts = getFabricatedFacts(sessionId).filter((f) => f.status === "active");
  const userMessageCount = getMessages(sessionId).filter((m) => m.role === "user").length;
  const phase = decideSessionPhase({ fabricatedFactCount: facts.length, userMessageCount });
  return { phase, limits: phaseLimits(phase), fabricatedFactCount: facts.length, userMessageCount, graph: buildLieGraph(sessionId, workId) };
}

export async function GET(_req: Request, context: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await context.params;
  const session = getSession(sessionId);
  if (!session) {
    return NextResponse.json({ error: "session not found" }, { status: 404 });
  }

  let writer: SseWriter | null = null;
  let unsubscribe: (() => void) | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      writer = createSseWriter(controller);
      const { send } = writer;

      const init: DevEventsInit = snapshot(sessionId, session.workId);
      send("init", init);

      unsubscribe = subscribePipelineEvents(sessionId, (event: PipelineEvent) => {
        send("stage", event);
        if (event.stage !== "saved") return;
        const now = snapshot(sessionId, session.workId);
        const graph: DevEventsGraph = {
          graph: now.graph,
          newFactIds: event.newFactIds,
          phase: now.phase,
          limits: now.limits,
          fabricatedFactCount: now.fabricatedFactCount,
        };
        send("graph", graph);
      });

      // プロキシに切られないための空打ち。データは無い
      heartbeat = setInterval(() => send("ping", {}), HEARTBEAT_MS);
    },
    cancel() {
      unsubscribe?.();
      if (heartbeat) clearInterval(heartbeat);
      writer?.markClosed();
    },
  });

  return new Response(stream, { headers: SSE_HEADERS });
}
