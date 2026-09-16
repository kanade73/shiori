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

async function snapshot(sessionId: string, workId: string) {
  const facts = (await getFabricatedFacts(sessionId)).filter((f) => f.status === "active");
  const userMessageCount = (await getMessages(sessionId)).filter((m) => m.role === "user").length;
  const phase = decideSessionPhase({ fabricatedFactCount: facts.length, userMessageCount });
  const graph = await buildLieGraph(sessionId, workId);
  return { phase, limits: phaseLimits(phase), fabricatedFactCount: facts.length, userMessageCount, graph };
}

export async function GET(_req: Request, context: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await context.params;
  const session = await getSession(sessionId);
  if (!session) {
    return NextResponse.json({ error: "session not found" }, { status: 404 });
  }

  let writer: SseWriter | null = null;
  let unsubscribe: (() => void) | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      writer = createSseWriter(controller);
      const { send } = writer;

      const relay = (event: PipelineEvent) => {
        send("stage", event);
        if (event.stage !== "saved") return;
        // 保存された嘘を読み直してから描き直す（DB を引くので、届いてすぐには送れない）
        void snapshot(sessionId, session.workId)
          .then((now) => {
            const graph: DevEventsGraph = {
              graph: now.graph,
              newFactIds: event.newFactIds,
              phase: now.phase,
              limits: now.limits,
              fabricatedFactCount: now.fabricatedFactCount,
            };
            send("graph", graph);
          })
          .catch((error) => console.error("開発者モードのグラフの更新に失敗:", error));
      };

      // 購読は init を組み立てる前に張る（DB を待っている間の段を取りこぼさないため）。
      // init より先に段を送らないよう、それまでは溜めておく
      let pending: PipelineEvent[] | null = [];
      unsubscribe = subscribePipelineEvents(sessionId, (event: PipelineEvent) => {
        if (pending) pending.push(event);
        else relay(event);
      });

      const init: DevEventsInit = await snapshot(sessionId, session.workId);
      send("init", init);
      const buffered = pending;
      pending = null;
      for (const event of buffered) relay(event);

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
