/**
 * Route Handler から text/event-stream を返すための小さな書き込み口。
 * クライアントが切断（タブを閉じる・リロード）すると controller は閉じられるが、
 * その後も generate 等の await が続いていれば send() が呼ばれうる。閉じた後の
 * enqueue は例外になるので、ここで握りつぶして「以降は送らない」に倒す。
 */

const CHUNK_SIZE = 4;
const CHUNK_INTERVAL_MS = 18;

export function sseEvent(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 見た目上のストリーミングのために本文を小さく刻む。 */
export function chunkText(text: string, size = CHUNK_SIZE): string[] {
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += size) chunks.push(text.slice(i, i + size));
  return chunks;
}

export type SseWriter = {
  send: (event: string, data: unknown) => void;
  /** 本文を token イベントに刻んで流す。 */
  streamText: (text: string) => Promise<void>;
  /** クライアント切断時に呼ぶ。以降の send は黙って無視する。 */
  markClosed: () => void;
  /** 生成が終わったら呼ぶ。二重 close は無視する。 */
  close: () => void;
};

export function createSseWriter(controller: ReadableStreamDefaultController<Uint8Array>): SseWriter {
  const encoder = new TextEncoder();
  let closed = false;

  const send = (event: string, data: unknown) => {
    if (closed) return;
    try {
      controller.enqueue(encoder.encode(sseEvent(event, data)));
    } catch {
      closed = true;
    }
  };

  return {
    send,
    async streamText(text) {
      for (const chunk of chunkText(text)) {
        send("token", { text: chunk });
        await sleep(CHUNK_INTERVAL_MS);
      }
    },
    markClosed() {
      closed = true;
    },
    close() {
      if (closed) return;
      closed = true;
      try {
        controller.close();
      } catch {
        // 既に閉じられていた（クライアント切断）。
      }
    },
  };
}

export const SSE_HEADERS = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
} as const;
