import { NextResponse } from "next/server";
import { appendMessage, addFabricatedFact, getMessages, getSession, saveMessageClaims } from "@/lib/server/store";
import { getWork } from "@/lib/server/works";
import { runConversationPipeline, runToshioInterjection, fallbackMessage } from "@/lib/server/llm/pipeline";
import { isRateLimited } from "@/lib/server/rate-limit";
import { createSseWriter, SSE_HEADERS, type SseWriter } from "@/lib/server/sse";
import { emitPipelineEvent } from "@/lib/server/events";
import type { Message } from "@/lib/server/types";

const MAX_CONTENT_LENGTH = 1000;
// シオリに渡す直近の履歴。としおの発話は generate 側で落とすので、実質ユーザー↔シオリの往復5回分。
const HISTORY_LIMIT = 12;

export async function GET(_req: Request, context: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await context.params;
  if (!getSession(sessionId)) {
    return NextResponse.json({ error: "session not found" }, { status: 404 });
  }
  return NextResponse.json({ messages: getMessages(sessionId) });
}

export async function POST(req: Request, context: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await context.params;
  const session = getSession(sessionId);
  if (!session) {
    return NextResponse.json({ error: "session not found" }, { status: 404 });
  }

  // 答え合わせで真偽を明かした会話は、そこで終わり（嘘を知ったうえで続けても、もう効かない）
  if (session.reveal) {
    return NextResponse.json({ error: "このセッションは答え合わせ済みです。新しいセッションを始めてください。" }, { status: 409 });
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

  const storedMessages = getMessages(sessionId);
  const historyBefore: Message[] = storedMessages.slice(-HISTORY_LIMIT);
  // 進行度はセッション全体で数える。history は直近だけに打ち切ってあるので、
  // 実数（今回の発話を含む）をパイプラインに渡す。
  const userMessageCount = storedMessages.filter((m) => m.role === "user").length + 1;
  appendMessage(sessionId, "user", content);

  let writer: SseWriter | null = null;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      writer = createSseWriter(controller);
      const { send, streamText, close } = writer;

      try {
        const { analysis, generation, evaluation, phase, regenerated, newFabricatedClaims, reusedFabricatedFactIds, turnId } =
          await runConversationPipeline({
            workId: session.workId,
            workTitle: work.title,
            sessionId,
            currentEpisode: session.currentEpisode,
            history: historyBefore,
            userMessage: content,
            userMessageCount,
          });

        send("message-start", { speaker: "shiori" });
        await streamText(generation.message);

        const assistantMessage = appendMessage(sessionId, "assistant", generation.message, "shiori");
        // 答え合わせ用に、この返答の主張を真偽（grounding）と抜き出し位置（quote）ごと残す
        saveMessageClaims(sessionId, assistantMessage.id, generation.claims);

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

        // 保存まで終わったことを開発者モードのパネルに知らせる（グラフはここから描き直される）
        emitPipelineEvent(sessionId, {
          turnId,
          at: new Date().toISOString(),
          stage: "saved",
          newFactIds,
          strategy: generation.strategy,
          phase,
        });

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
          phase,
          turnId,
        });
        if (toshioMessage) {
          send("message-start", { speaker: "toshio" });
          await streamText(toshioMessage);
          appendMessage(sessionId, "assistant", toshioMessage, "toshio");
          // としおの発話は嘘の仕組み（FabricatedFact / strategy）に乗っていない
          send("metadata", { fabricatedFactIds: [], strategy: "no_new_lie", regenerated: false });
          send("message-end", {});
        }

        // 進行度はフロントに流すだけ（UI は未実装）。終盤に達したことを検出できればよい。
        send("done", { phase });
      } catch (error) {
        console.error(`[sessions/${sessionId}/messages] pipeline failed:`, error);
        const fallback = fallbackMessage();
        send("message-start", { speaker: "shiori" });
        await streamText(fallback);
        const fallbackMessageRecord = appendMessage(sessionId, "assistant", fallback, "shiori");
        saveMessageClaims(sessionId, fallbackMessageRecord.id, []);
        send("metadata", { fabricatedFactIds: [], strategy: "no_new_lie", regenerated: false });
        send("message-end", {});
        send("done", { phase: "early" });
      } finally {
        close();
      }
    },
    cancel() {
      // クライアントが切断した。以降の send() を黙って無視させる。
      writer?.markClosed();
    },
  });

  return new Response(stream, { headers: SSE_HEADERS });
}
