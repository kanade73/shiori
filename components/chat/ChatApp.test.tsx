import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { SendMessageHandlers } from "@/lib/client/api";

// issue #6: 1回の送信でシオリ→としおと複数の吹き出しが積まれること、
// としおの吹き出しに名前が付くことを固定する。API は差し替える。
const mocks = vi.hoisted(() => ({
  getSessionData: vi.fn(),
  listSessions: vi.fn(),
  sendMessage: vi.fn(),
  deleteSession: vi.fn(),
  createSession: vi.fn(),
  push: vi.fn(),
}));
vi.mock("@/lib/client/api", () => mocks);
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push }) }));

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
    h.onDone({ phase: "early" });
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
  mocks.listSessions.mockResolvedValue([]);
});

describe("ChatApp: 1回の送信で複数の吹き出しを積む", () => {
  it("シオリの吹き出しの後にとしおの吹き出しが別に増える。としおの名前の横に「考察」の印は付けない", async () => {
    mocks.sendMessage.mockImplementation(streamed([["shiori", "そうだね。"], ["toshio", "結論から言うとね。"]]));
    await renderAndSend("これって伏線じゃない？");

    await waitFor(() => expect(assistantBubbles()).toHaveLength(2));
    const [shiori, toshio] = assistantBubbles();
    expect(within(shiori).getByText("シオリ")).toBeTruthy();
    expect(within(shiori).getByText("そうだね。")).toBeTruthy();
    expect(within(shiori).queryByText("考察")).toBeNull();
    expect(within(toshio).getByText("としお")).toBeTruthy();
    expect(within(toshio).getByText("結論から言うとね。")).toBeTruthy();
    expect(within(toshio).queryByText("考察")).toBeNull();
  });

  // issue #10: プロフ画像も話者ごとに出し分ける（以前はとしおにもシオリの画像を代用していた）
  it("としおの吹き出しにはとしおの、シオリの吹き出しにはシオリのプロフ画像が出る", async () => {
    mocks.sendMessage.mockImplementation(streamed([["shiori", "そうだね。"], ["toshio", "結論から言うとね。"]]));
    await renderAndSend("これって伏線じゃない？");

    await waitFor(() => expect(assistantBubbles()).toHaveLength(2));
    const [shiori, toshio] = assistantBubbles();
    expect(shiori.querySelector("img")?.getAttribute("src")).toBe("/character/avatar-128.png");
    expect(toshio.querySelector("img")?.getAttribute("src")).toBe("/character/toshio-128.png");
    expect(within(toshio).getByAltText("としお")).toBeTruthy();
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

  it("としおの message-start の後、本文が届くまでの入力中表示はとしおの画像で出る", async () => {
    let release!: () => void;
    mocks.sendMessage.mockImplementation(
      (_s: string, _c: string, h: SendMessageHandlers) =>
        new Promise<void>((resolve) => {
          h.onMessageStart("shiori");
          h.onToken("そうだね。");
          h.onMessageEnd();
          h.onMessageStart("toshio");
          release = () => {
            h.onToken("結論から言うとね。");
            h.onMessageEnd();
            h.onDone({ phase: "early" });
            resolve();
          };
        }),
    );
    await renderAndSend("これって伏線じゃない？");

    const typing = (await screen.findByText("入力中")).parentElement!.parentElement!;
    expect(typing.querySelector("img")?.getAttribute("src")).toBe("/character/toshio-128.png");

    release();
    await screen.findByText("結論から言うとね。");
  });
});

describe("ChatApp: 途中で切れたストリーム", () => {
  it("message-start の後に失敗したら、その吹き出しに定型文を入れて閉じる（入力中のまま残さない）", async () => {
    mocks.sendMessage.mockImplementation(async (_s: string, _c: string, h: SendMessageHandlers) => {
      h.onMessageStart("shiori");
      throw new Error("network");
    });
    await renderAndSend("hi");

    await screen.findByText("network");
    const [bubble] = assistantBubbles();
    expect(within(bubble).getByText("ちょっと分からなくなった。もう一度言って。")).toBeTruthy();
    expect(screen.queryByText("入力中")).toBeNull();
  });
});

describe("ChatApp: 話題の場面（issue #14）", () => {
  it("話題の無いセッションは、視聴済み話数が分かっていても話数を出さない", async () => {
    render(<ChatApp sessionId="s1" />);
    const header = await screen.findByRole("banner");
    expect(within(header).getByText("話題はこれから")).toBeTruthy();
    expect(screen.queryByText(/話まで/)).toBeNull();
  });

  it("話題が決まるまではヘッダーに「話題はこれから」、topic が届いたらその場面の名前を出す", async () => {
    const topic = {
      title: "草むしり検定編",
      summary: "検定の話。",
      facts: [],
      sources: [],
      query: "検定のところ",
      resolvedAt: "2026-09-15T00:00:00.000Z",
    };
    mocks.getSessionData.mockResolvedValue({
      work,
      session: { ...session, currentEpisode: 0 },
      messages: [],
      fabricatedFactCount: 0,
    });
    mocks.sendMessage.mockImplementation(async (_s: string, _c: string, h: SendMessageHandlers) => {
      h.onTopic?.(topic);
      await streamed([["shiori", "あの回ね。"]])(_s, _c, h);
    });

    render(<ChatApp sessionId="s1" />);
    const header = await screen.findByRole("banner");
    expect(within(header).getByText("話題はこれから")).toBeTruthy();

    fireEvent.change(await screen.findByPlaceholderText("感想やシーンの話を送ってみて..."), { target: { value: "検定のところ" } });
    fireEvent.click(screen.getByRole("button", { name: "送信" }));
    await waitFor(() => expect(within(header).getByText("草むしり検定編")).toBeTruthy());
  });
});

describe("ChatApp: 答え合わせ", () => {
  it("答え合わせ前はヘッダーに答え合わせへの導線があり、入力欄が出る。偽設定の確認画面への導線は無い", async () => {
    render(<ChatApp sessionId="s1" />);
    const link = await screen.findByRole("link", { name: "答え合わせ" });
    expect(link.getAttribute("href")).toBe("/reveal/s1");
    expect(screen.getByPlaceholderText("感想やシーンの話を送ってみて...")).toBeTruthy();
    expect(screen.queryByText("偽設定を確認")).toBeNull();
  });

  it("答え合わせ済みなら入力欄の代わりに、結果と新しいセッションへの導線を出す", async () => {
    mocks.getSessionData.mockResolvedValue({
      work,
      session: { ...session, reveal: { revealedAt: "2026-09-14T00:00:00.000Z", guesses: {} } },
      messages: [],
      fabricatedFactCount: 0,
    });
    render(<ChatApp sessionId="s1" />);
    expect(await screen.findByText("この会話は答え合わせ済み。ここから先は、新しいセッションで。")).toBeTruthy();
    expect(screen.queryByPlaceholderText("感想やシーンの話を送ってみて...")).toBeNull();
    expect(screen.getByRole("link", { name: "答え合わせの結果" }).getAttribute("href")).toBe("/reveal/s1");
    expect(screen.getByRole("link", { name: "結果を見る" }).getAttribute("href")).toBe("/reveal/s1");
  });
});

describe("ChatApp: 過去のセッションの削除", () => {
  const summary = (id: string, progressDescription: string) => ({
    id,
    workId: "w",
    currentEpisode: 3,
    progressDescription,
    createdAt: "",
    updatedAt: "2026-09-14T00:00:00.000Z",
    fabricatedFactCount: 0,
  });

  beforeEach(() => {
    mocks.listSessions.mockResolvedValue([summary("s1", "いまの会話"), summary("s2", "前の会話")]);
    mocks.deleteSession.mockResolvedValue(undefined);
  });

  async function openDialog(label: string) {
    render(<ChatApp sessionId="s1" />);
    fireEvent.click(await screen.findByRole("button", { name: `「${label}」のセッションを削除` }));
    return screen.getByRole("alertdialog");
  }

  it("ゴミ箱を押すと、シオリが吹き出しで「ほんとうに消しちゃうの...?」と聞き、はい/いいえの2択を出す", async () => {
    const dialog = await openDialog("前の会話");
    expect(within(dialog).getByText("ほんとうに消しちゃうの...?")).toBeTruthy();
    expect(within(dialog).getByText("「前の会話」の会話")).toBeTruthy();
    expect(within(dialog).getByAltText("シオリ")).toBeTruthy();
    const buttons = within(dialog).getAllByRole("button");
    expect(buttons.map((b) => b.textContent)).toEqual(["はい", "いいえ"]);
    // 開いた時点では「いいえ」にフォーカスがある（Enter で消してしまわない）
    expect(document.activeElement).toBe(within(dialog).getByRole("button", { name: "いいえ" }));
    // まだ消していない
    expect(mocks.deleteSession).not.toHaveBeenCalled();
  });

  it("「はい」で、そのセッションを消して一覧から外す", async () => {
    const dialog = await openDialog("前の会話");
    fireEvent.click(within(dialog).getByRole("button", { name: "はい" }));

    await waitFor(() => expect(screen.queryByRole("button", { name: "「前の会話」のセッションを削除" })).toBeNull());
    expect(mocks.deleteSession).toHaveBeenCalledWith("s2");
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it("「いいえ」・Esc・背景のクリックでは消さずに閉じる", async () => {
    fireEvent.click(within(await openDialog("前の会話")).getByRole("button", { name: "いいえ" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "「前の会話」のセッションを削除" }));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("alertdialog")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "「前の会話」のセッションを削除" }));
    fireEvent.click(screen.getByRole("alertdialog").parentElement!);
    expect(screen.queryByRole("alertdialog")).toBeNull();

    expect(mocks.deleteSession).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "「前の会話」のセッションを削除" })).toBeTruthy();
  });

  it("削除に失敗したら、ダイアログを閉じずにエラーを出す", async () => {
    mocks.deleteSession.mockRejectedValue(new Error("session not found"));
    const dialog = await openDialog("前の会話");
    fireEvent.click(within(dialog).getByRole("button", { name: "はい" }));

    expect(await within(dialog).findByText("session not found")).toBeTruthy();
    expect(screen.getByRole("alertdialog")).toBeTruthy();
  });

  it("開いているセッションを消したら、最初の画面へ移る", async () => {
    const dialog = await openDialog("いまの会話");
    fireEvent.click(within(dialog).getByRole("button", { name: "はい" }));

    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith("/"));
    expect(mocks.deleteSession).toHaveBeenCalledWith("s1");
  });
});

describe("ChatApp: サイドバー", () => {
  it("作品の欄にもセッション一覧にも、生成された嘘の件数は出さない。答え合わせ済みの印は出す", async () => {
    mocks.listSessions.mockResolvedValue([
      { ...session, progressDescription: "いまの会話", updatedAt: "2026-09-14T00:00:00.000Z", fabricatedFactCount: 4 },
      {
        ...session,
        id: "s2",
        progressDescription: "前の会話",
        updatedAt: "2026-09-13T00:00:00.000Z",
        fabricatedFactCount: 7,
        reveal: { revealedAt: "2026-09-13T01:00:00.000Z", guesses: {} },
      },
    ]);
    render(<ChatApp sessionId="s1" />);
    expect(await screen.findByText("前の会話")).toBeTruthy();
    expect(screen.queryByText("生成された嘘")).toBeNull();
    expect(screen.queryByText(/^\d+件$/)).toBeNull();
    expect(screen.getByText("答え合わせ済み")).toBeTruthy();
  });
});

describe("ChatApp: 新しいセッション", () => {
  beforeEach(() => {
    mocks.createSession.mockResolvedValue({ sessionId: "s-new", openingMessage: "今日は何について話したい?" });
  });

  it("サイドバーの「新しいセッション」は、スタート画面に戻らず、今の作品で新しいセッションを作ってそのチャットに移る", async () => {
    render(<ChatApp sessionId="s1" />);
    fireEvent.click(await screen.findByRole("button", { name: "新しいセッション" }));

    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith("/chat/s-new"));
    expect(mocks.createSession).toHaveBeenCalledWith("w");
    expect(mocks.push).not.toHaveBeenCalledWith("/");
    expect(screen.queryByRole("link", { name: "新しいセッション" })).toBeNull();
  });

  it("答え合わせ済みの会話の下の「新しいセッション」も同じ", async () => {
    mocks.getSessionData.mockResolvedValue({
      work,
      session: { ...session, reveal: { revealedAt: "2026-09-14T00:00:00.000Z", guesses: {} } },
      messages: [],
      fabricatedFactCount: 0,
    });
    render(<ChatApp sessionId="s1" />);
    await screen.findByText("この会話は答え合わせ済み。ここから先は、新しいセッションで。");
    const buttons = screen.getAllByRole("button", { name: "新しいセッション" });
    expect(buttons).toHaveLength(2);
    fireEvent.click(buttons[1]);

    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith("/chat/s-new"));
    expect(mocks.createSession).toHaveBeenCalledTimes(1);
  });

  it("作成に失敗したら、画面を移らずにエラーを出す", async () => {
    mocks.createSession.mockRejectedValue(new Error("work not found"));
    render(<ChatApp sessionId="s1" />);
    fireEvent.click(await screen.findByRole("button", { name: "新しいセッション" }));

    expect(await screen.findByText("work not found")).toBeTruthy();
    expect(mocks.push).not.toHaveBeenCalled();
    expect((screen.getByRole("button", { name: "新しいセッション" }) as HTMLButtonElement).disabled).toBe(false);
  });
});

describe("ChatApp: シオリの表情", () => {
  it("message-start の表情が吹き出しのアバターに出る。としおには付かない", async () => {
    mocks.sendMessage.mockImplementation(async (_s: string, _c: string, h: SendMessageHandlers) => {
      h.onMessageStart("shiori", "wink");
      h.onToken("別に、嘘じゃない。");
      h.onMetadata({ fabricatedFactIds: [], strategy: "no_new_lie", regenerated: false });
      h.onMessageEnd();
      h.onMessageStart("toshio");
      h.onToken("結論から言うとね。");
      h.onMetadata({ fabricatedFactIds: [], strategy: "no_new_lie", regenerated: false });
      h.onMessageEnd();
      h.onDone({ phase: "early" });
    });
    await renderAndSend("それ本当？");
    await waitFor(() => expect(assistantBubbles()).toHaveLength(2));
    const [shiori, toshio] = assistantBubbles();
    expect(shiori.querySelector("[data-expression]")?.getAttribute("data-expression")).toBe("wink");
    expect(shiori.querySelector("img")?.getAttribute("src")).toBe("/character/avatar-wink-128.png");
    expect(toshio.querySelector("[data-expression]")).toBeNull();
    expect(toshio.querySelector("img")?.getAttribute("src")).toBe("/character/toshio-128.png");
  });

  it("保存済みの発話の表情も再読み込みで出る。表情の無い旧データと開始の定型文は neutral", async () => {
    mocks.getSessionData.mockResolvedValue({
      work,
      session,
      fabricatedFactCount: 0,
      messages: [
        { id: "m1", sessionId: "s1", role: "assistant", content: "今日は何について話したい?", createdAt: "2026-01-01T00:00:00Z", speaker: "shiori" },
        { id: "m2", sessionId: "s1", role: "user", content: "考察して", createdAt: "2026-01-01T00:00:01Z" },
        { id: "m3", sessionId: "s1", role: "assistant", content: "ふふ。", createdAt: "2026-01-01T00:00:02Z", speaker: "shiori", expression: "wink" },
      ],
    });
    render(<ChatApp sessionId="s1" />);
    await screen.findByPlaceholderText("感想やシーンの話を送ってみて...");
    const [first, second] = assistantBubbles();
    expect(first.querySelector("img")?.getAttribute("src")).toBe("/character/avatar-128.png");
    expect(second.querySelector("img")?.getAttribute("src")).toBe("/character/avatar-wink-128.png");
  });
});
