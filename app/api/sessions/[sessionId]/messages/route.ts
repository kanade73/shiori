import { NextResponse } from "next/server";
import { appendMessage, addFabricatedFact, getMessages, getSession } from "@/lib/server/store";
import { getWork } from "@/lib/server/works";
import { runConversationPipeline, runToshioInterjection, fallbackMessage } from "@/lib/server/llm/pipeline";
import { isRateLimited } from "@/lib/server/rate-limit";
import type { Message } from "@/lib/server/types";

const MAX_CONTENT_LENGTH = 1000;
const HISTORY_LIMIT = 16;

export async function GET(_req: Request, context: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await context.params;
  if (!getSession(sessionId)) {
    return NextResponse.json({ error: "session not found" }, { status: 404 });
  }
  return NextResponse.json({ messages: getMessages(sessionId) });
}

function sseEvent(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Splits text into small chunks to render as a visible stream on the client. */
function chunkText(text: string): string[] {
  const chunks: string[] = [];
  const size = 4;
  for (let i = 0; i < text.length; i += size) {
    chunks.push(text.slice(i, i + size));
  }
  return chunks;
}

export async function POST(req: Request, context: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await context.params;
  const session = getSession(sessionId);
  if (!session) {
    return NextResponse.json({ error: "session not found" }, { status: 404 });
  }

  if (isRateLimited(sessionId)) {
    return NextResponse.json({ error: "too many requests" }, { status: 429 });
  }

  const body = await req.json().catch(() => null);
  const content = typeof body?.content === "string" ? body.content.trim() : "";
  if (!content) {
    return NextResponse.json({ error: "content is required" }, { status: 400 });
  }
  if (content.length > MAX_CONTENT_LENGTH) {
    return NextResponse.json({ error: `content must be ${MAX_CONTENT_LENGTH} characters or fewer` }, { status: 400 });
  }

  const work = getWork(session.workId);
  if (!work) {
    return NextResponse.json({ error: "work not found" }, { status: 404 });
  }

  const historyBefore: Message[] = getMessages(sessionId).slice(-HISTORY_LIMIT);
  appendMessage(sessionId, "user", content);

  // クライアントが切断（タブを閉じる/リロード等）すると controller は自動で
  // close されるが、その後も generate 等の await が続いていれば send() が
  // 呼ばれうる。enqueue-after-close は例外になり、握りつぶさないとサーバー
  // ログにエラーが残るだけでなく catch 側のフォールバック送信も同じ理由で
  // 失敗し、ユーザーには何も返らないまま消える（"問いかけに返事がない"）。
  let closed = false;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      const send = (event: string, data: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(sseEvent(event, data)));
        } catch {
          // クライアント切断等で controller が既に閉じていた。以降は送らない。
          closed = true;
        }
      };

      const streamText = async (text: string) => {
        for (const chunk of chunkText(text)) {
          send("token", { text: chunk });
          await sleep(18);
        }
      };

      try {
        const { analysis, generation, evaluation, regenerated, newFabricatedClaims, reusedFabricatedFactIds } =
          await runConversationPipeline({
            workId: session.workId,
            workTitle: work.title,
            sessionId,
            currentEpisode: session.currentEpisode,
            history: historyBefore,
            userMessage: content,
          });

        send("message-start", { speaker: "shiori" });
        await streamText(generation.message);

        const assistantMessage = appendMessage(sessionId, "assistant", generation.message, "shiori");

        const newFactIds: string[] = [];
        for (const claim of newFabricatedClaims) {
          const fact = addFabricatedFact({
            sessionId,
            subject: claim.subject,
            relation: claim.relation,
            object: claim.object,
            negated: claim.negated,
            claim: claim.claim,
            sourceCanonFactIds: claim.sourceCanonFactIds,
            introducedMessageId: assistantMessage.id,
            confidence: Math.round((1 - evaluation.canonContradictionScore) * 100) / 100,
          });
          newFactIds.push(fact.id);
        }

        send("metadata", {
          fabricatedFactIds: [...newFactIds, ...reusedFabricatedFactIds],
          strategy: generation.strategy,
          regenerated,
        });
        send("message-end", {});

        // issue #6: シオリの返答を出し切ってから、材料が揃っているときだけ「としお」が割り込む。
        // シオリの嘘は保存済みなので、としおには今ついた嘘も「既に語った設定」として渡る。
        const toshioMessage = await runToshioInterjection({
          workId: session.workId,
          workTitle: work.title,
          sessionId,
          currentEpisode: session.currentEpisode,
          history: historyBefore,
          userMessage: content,
          analysis,
          generation,
        });
        if (toshioMessage) {
          send("message-start", { speaker: "toshio" });
          await streamText(toshioMessage);
          appendMessage(sessionId, "assistant", toshioMessage, "toshio");
          // としおの発話は嘘の仕組み（FabricatedFact / strategy）に乗っていない
          send("metadata", { fabricatedFactIds: [], strategy: "no_new_lie", regenerated: false });
          send("message-end", {});
        }

        send("done", {});
      } catch (error) {
        console.error(`[sessions/${sessionId}/messages] pipeline failed:`, error);
        const fallback = fallbackMessage();
        send("message-start", { speaker: "shiori" });
        await streamText(fallback);
        appendMessage(sessionId, "assistant", fallback, "shiori");
        send("metadata", { fabricatedFactIds: [], strategy: "no_new_lie", regenerated: false });
        send("message-end", {});
        send("done", {});
      } finally {
        if (!closed) {
          closed = true;
          try {
            controller.close();
          } catch {
            // 既に閉じられていた（クライアント切断）。何もすることはない。
          }
        }
      }
    },
    cancel() {
      // クライアントが切断した。以降の send() を黙って無視させる。
      closed = true;
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
