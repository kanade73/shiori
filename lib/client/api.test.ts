import { afterEach, describe, expect, it, vi } from "vitest";
import { sendMessage, type SendMessageHandlers } from "./api";

// サーバーの SSE（route.ts）をクライアントがどう handlers に振り分けるかを固定する。
// fetch は差し替え、本文は route.ts と同じ `event:/data:` 形式で書く。

function sse(frames: [string, unknown][]): Response {
  const body = frames.map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`).join("");
  return new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } });
}

function recordingHandlers() {
  const calls: string[] = [];
  const handlers: SendMessageHandlers = {
    onMessageStart: (speaker) => calls.push(`start:${speaker}`),
    onToken: (text) => calls.push(`token:${text}`),
    onMetadata: (data) => calls.push(`metadata:${data.fabricatedFactIds.join(",")}`),
    onMessageEnd: () => calls.push("end"),
    onDone: () => calls.push("done"),
  };
  return { calls, handlers };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("sendMessage: 複数の発話を message-start / message-end で区切って届ける", () => {
  it("シオリ→としおの順に、各発話の開始・token・metadata・終了を対応する handler に渡す", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        sse([
          ["message-start", { speaker: "shiori" }],
          ["token", { text: "そう" }],
          ["token", { text: "だね" }],
          ["metadata", { fabricatedFactIds: ["ff-1"], strategy: "introduce_small_lie", regenerated: false }],
          ["message-end", {}],
          ["message-start", { speaker: "toshio" }],
          ["token", { text: "結論から" }],
          ["metadata", { fabricatedFactIds: [], strategy: "introduce_small_lie", regenerated: false }],
          ["message-end", {}],
          ["done", {}],
        ]),
      ),
    );
    const { calls, handlers } = recordingHandlers();
    await sendMessage("s1", "hi", handlers);
    expect(calls).toEqual([
      "start:shiori",
      "token:そう",
      "token:だね",
      "metadata:ff-1",
      "end",
      "start:toshio",
      "token:結論から",
      "metadata:",
      "end",
      "done",
    ]);
  });

  it("HTTP エラーはサーバーの error 文言で例外にする", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "too many requests" }), { status: 429 })),
    );
    const { calls, handlers } = recordingHandlers();
    await expect(sendMessage("s1", "hi", handlers)).rejects.toThrow("too many requests");
    expect(calls).toEqual([]);
  });
});
