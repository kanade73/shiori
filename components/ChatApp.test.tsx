import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { SendMessageHandlers } from "@/lib/client/api";

// issue #6: 1回の送信でシオリ→としおと複数の吹き出しが積まれること、
// としおの吹き出しに名前と「考察」バッジが付くことを固定する。API は差し替える。
const mocks = vi.hoisted(() => ({
  getSessionData: vi.fn(),
  getFabricatedFacts: vi.fn(),
  listSessions: vi.fn(),
  sendMessage: vi.fn(),
}));
vi.mock("@/lib/client/api", () => mocks);

import { ChatApp } from "./ChatApp";

const work = { id: "w", title: "テスト作品", createdAt: "" };
const session = { id: "s1", workId: "w", currentEpisode: 3, createdAt: "", updatedAt: "" };

/** route.ts が流す順で handlers を叩く sendMessage の代役 */
function streamed(bubbles: [speaker: "shiori" | "toshio", text: string][]) {
  return async (_sessionId: string, _content: string, h: SendMessageHandlers) => {
    for (const [speaker, text] of bubbles) {
      h.onMessageStart(speaker);
      h.onToken(text);
      h.onMetadata({ fabricatedFactIds: [], strategy: "no_new_lie", regenerated: false });
      h.onMessageEnd();
    }
    h.onDone();
  };
}

async function renderAndSend(text: string) {
  render(<ChatApp sessionId="s1" />);
  const textarea = await screen.findByPlaceholderText("感想やシーンの話を送ってみて...");
  fireEvent.change(textarea, { target: { value: text } });
  fireEvent.click(screen.getByRole("button", { name: "送信" }));
}

/** アシスタントの吹き出し（ChatMessageItem の assistant 側ルート）。サイドバーの「シオリ」表記は含めない */
function assistantBubbles() {
  return Array.from(document.querySelectorAll<HTMLElement>("div.group.animate-fade-up"));
}

afterEach(cleanup);

beforeEach(() => {
  vi.clearAllMocks();
  Element.prototype.scrollTo = vi.fn();
  mocks.getSessionData.mockResolvedValue({ work, session, messages: [], fabricatedFactCount: 0 });
  mocks.getFabricatedFacts.mockResolvedValue([]);
  mocks.listSessions.mockResolvedValue([]);
});

describe("ChatApp: 1回の送信で複数の吹き出しを積む", () => {
  it("シオリの吹き出しの後にとしおの吹き出しが別に増え、としおには「考察」バッジが付く", async () => {
    mocks.sendMessage.mockImplementation(streamed([["shiori", "そうだね。"], ["toshio", "結論から言うとね。"]]));
    await renderAndSend("これって伏線じゃない？");

    await waitFor(() => expect(assistantBubbles()).toHaveLength(2));
    const [shiori, toshio] = assistantBubbles();
    expect(within(shiori).getByText("シオリ")).toBeTruthy();
    expect(within(shiori).getByText("そうだね。")).toBeTruthy();
    expect(within(shiori).queryByText("考察")).toBeNull();
    expect(within(toshio).getByText("としお")).toBeTruthy();
    expect(within(toshio).getByText("結論から言うとね。")).toBeTruthy();
    expect(within(toshio).getByText("考察")).toBeTruthy();
  });

  it("としおが割り込まなければ吹き出しはシオリの1つだけ", async () => {
    mocks.sendMessage.mockImplementation(streamed([["shiori", "そうだね。"]]));
    await renderAndSend("1話面白かった");

    await waitFor(() => expect(assistantBubbles()).toHaveLength(1));
    expect(screen.queryByText("としお")).toBeNull();
  });

  it("保存済みのとしおの発話（speaker=toshio）も再読み込み時に「としお」として表示する", async () => {
    mocks.getSessionData.mockResolvedValue({
      work,
      session,
      fabricatedFactCount: 0,
      messages: [
        { id: "m1", sessionId: "s1", role: "user", content: "hi", createdAt: "2026-01-01T00:00:00Z" },
        { id: "m2", sessionId: "s1", role: "assistant", content: "……どうも", createdAt: "2026-01-01T00:00:01Z" },
        { id: "m3", sessionId: "s1", role: "assistant", content: "結論から言うとね。", createdAt: "2026-01-01T00:00:02Z", speaker: "toshio" },
      ],
    });
    render(<ChatApp sessionId="s1" />);
    await screen.findByText("結論から言うとね。");
    const [old, toshio] = assistantBubbles();
    // speaker 無しの古いメッセージはシオリ扱い
    expect(within(old).getByText("シオリ")).toBeTruthy();
    expect(within(toshio).getByText("としお")).toBeTruthy();
  });

  it("送信が message-start の前に失敗したら、空の吹き出しを残さずエラーだけ出す", async () => {
    mocks.sendMessage.mockRejectedValue(new Error("too many requests"));
    await renderAndSend("hi");

    await screen.findByText("too many requests");
    expect(assistantBubbles()).toHaveLength(0);
  });
});

describe("ChatApp: 返答を待つ間の表示", () => {
  // PR 前は送信と同時に空の吹き出し（入力中インジケータ）が積まれていた。
  // 今は message-start が届くまで何も出ず、Gemini 2回分の待ち時間が無反応に見える。
  it("送信直後、message-start が届く前から入力中インジケータが出る", async () => {
    let release!: () => void;
    mocks.sendMessage.mockImplementation(
      (s: string, c: string, h: SendMessageHandlers) =>
        new Promise<void>((resolve) => {
          release = () => void streamed([["shiori", "そうだね。"]])(s, c, h).then(resolve);
        }),
    );
    await renderAndSend("これって伏線じゃない？");

    // 返答待ちの間
    expect(screen.queryByText("入力中")).not.toBeNull();

    // 返答が届いたら、その吹き出しがシオリの発話になる（吹き出しが二重にならない）
    release();
    await waitFor(() => expect(assistantBubbles()).toHaveLength(1));
    expect(screen.queryByText("入力中")).toBeNull();
  });
});
