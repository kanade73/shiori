import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Revealed } from "./verdict";

// 答え合わせ画面: 開いたらすぐ答え合わせをして（予想は取らない）、真偽つきの会話を出す。API は差し替える。
const mocks = vi.hoisted(() => ({
  getSessionData: vi.fn(),
  revealSession: vi.fn(),
  createSession: vi.fn(),
  push: vi.fn(),
}));
vi.mock("@/lib/client/api", () => mocks);
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push }) }));

import { RevealView } from "./RevealView";

const work = { id: "w", title: "テスト作品", createdAt: "" };
const session = { id: "s1", workId: "w", currentEpisode: 3, createdAt: "", updatedAt: "" };
const at = "2026-09-14T12:00:00.000Z";

function revealed(guesses: Record<string, "true" | "lie">): Revealed {
  return {
    status: "revealed",
    reveal: { revealedAt: at, guesses },
    hasUntrackedMessages: false,
    statements: [
      {
        id: "t1",
        messageId: "m1",
        verdict: "true",
        claim: "資格を取った",
        subject: "ちいかわ",
        relation: "has",
        object: "資格",
        negated: false,
        quote: "資格を取った",
        sources: [{ id: "c1", episodeFrom: 7, description: "検定に合格した" }],
      },
      {
        id: "l1",
        messageId: "m1",
        verdict: "lie",
        claim: "資格証の裏にレシピがある",
        subject: "ちいかわ",
        relation: "has",
        object: "レシピ",
        negated: false,
        quote: "裏にレシピがある",
        sources: [],
      },
    ],
    graph: {
      nodes: [
        { id: "statement:t1", kind: "statement", statementId: "t1", verdict: "true", label: "資格を取った", number: 1 },
        { id: "entity:ちいかわ", kind: "entity", label: "ちいかわ", known: true },
        { id: "canon:c1", kind: "canon", label: "検定に合格した", episodeFrom: 7 },
        { id: "statement:l1", kind: "statement", statementId: "l1", verdict: "lie", label: "資格証の裏にレシピがある", number: 2 },
        { id: "toshio:x1", kind: "toshio", messageId: "x1", label: "としおの考察 1" },
      ],
      edges: [
        { id: "subject:t1", from: "entity:ちいかわ", to: "statement:t1", kind: "subject", label: "持つ" },
        { id: "based_on:t1:c1", from: "statement:t1", to: "canon:c1", kind: "based_on" },
        { id: "subject:l1", from: "entity:ちいかわ", to: "statement:l1", kind: "subject", label: "持つ" },
        { id: "rode_on:x1:l1", from: "toshio:x1", to: "statement:l1", kind: "rode_on" },
      ],
    },
    messages: [
      { id: "u1", role: "user", content: "資格の話して", createdAt: at, segments: [{ text: "資格の話して" }], statementIds: [] },
      {
        id: "m1",
        role: "assistant",
        speaker: "shiori",
        content: "資格を取った。裏にレシピがある。",
        createdAt: at,
        segments: [
          { text: "資格を取った", statementId: "t1" },
          { text: "。" },
          { text: "裏にレシピがある", statementId: "l1" },
          { text: "。" },
        ],
        statementIds: ["t1", "l1"],
      },
      {
        id: "x1",
        role: "assistant",
        speaker: "toshio",
        content: "結論から言うとね。",
        createdAt: at,
        segments: [{ text: "結論から言うとね。" }],
        statementIds: [],
        premiseStatementIds: ["l1"],
      },
    ],
  };
}

afterEach(cleanup);

beforeEach(() => {
  vi.clearAllMocks();
  window.scrollTo = vi.fn();
  mocks.getSessionData.mockResolvedValue({ work, session, messages: [], fabricatedFactCount: 0 });
});

describe("RevealView", () => {
  it("本文に位置を付けられなかった主張も、本文の下に印付きで出す", async () => {
    const data = revealed({});
    data.statements.push({
      id: "l2",
      messageId: "m1",
      verdict: "lie",
      claim: "資格証は三枚ある",
      subject: "ちいかわ",
      relation: "has",
      object: "資格証",
      negated: false,
      quote: null,
      sources: [],
    });
    data.messages[1].statementIds.push("l2");
    mocks.revealSession.mockResolvedValue(data);
    render(<RevealView sessionId="s1" />);
    const list = await screen.findByTestId("reveal-unplaced");
    expect(list.textContent).toContain("資格証は三枚ある");
    // 位置が分かる主張は本文の印で出すので、下の一覧には重ねない
    expect(list.textContent).not.toContain("裏にレシピがある");
  });

  it("開いたらすぐ答え合わせをして結果を出す。予想の画面は挟まない", async () => {
    mocks.revealSession.mockResolvedValue(revealed({}));
    render(<RevealView sessionId="s1" />);
    expect((await screen.findAllByTestId("reveal-message")).length).toBeGreaterThan(0);
    expect(mocks.revealSession).toHaveBeenCalledWith("s1");
    expect(screen.queryByText("どれが嘘だったと思う？")).toBeNull();
    expect(screen.queryByRole("button", { name: /答えを見る/ })).toBeNull();
  });

  it("見出しには話題の名前を出し、話数は出さない", async () => {
    mocks.getSessionData.mockResolvedValue({
      work,
      session: {
        ...session,
        topic: { title: "草むしり検定編", summary: "", facts: [], sources: [], query: "", resolvedAt: at },
      },
      messages: [],
      fabricatedFactCount: 0,
    });
    mocks.revealSession.mockResolvedValue(revealed({}));
    render(<RevealView sessionId="s1" />);
    expect(await screen.findByText(/草むしり検定編/)).toBeTruthy();
    expect(screen.queryByText(/話まで/)).toBeNull();
  });

  it("としおの発言に「考察」の印を付けない", async () => {
    mocks.revealSession.mockResolvedValue(revealed({}));
    render(<RevealView sessionId="s1" />);
    expect(await screen.findByText("結論から言うとね。")).toBeTruthy();
    expect(screen.getByText("としお")).toBeTruthy();
    expect(screen.queryByText("考察")).toBeNull();
  });

  it("嘘の件数の概要は出さない。予想が記録された旧セッションでも正解数は出さない", async () => {
    mocks.revealSession.mockResolvedValue(revealed({ t1: "lie", l1: "lie" }));
    render(<RevealView sessionId="s1" />);
    expect(await screen.findByText("結論から言うとね。")).toBeTruthy();
    expect(screen.queryByText("会話に混ざっていた嘘")).toBeNull();
    expect(screen.queryByText(/確認できる話/)).toBeNull();
    expect(screen.queryByText(/件正解/)).toBeNull();
  });

  it("答え合わせに失敗したらエラーを出す", async () => {
    mocks.revealSession.mockRejectedValue(new Error("session not found"));
    render(<RevealView sessionId="s1" />);
    expect(await screen.findByText("session not found")).toBeTruthy();
  });

  it("結果には解説・根拠・注釈を出さない（印と引用文だけ）", async () => {
    mocks.revealSession.mockResolvedValue(revealed({}));
    render(<RevealView sessionId="s1" />);
    expect((await screen.findAllByTestId("reveal-message")).length).toBeGreaterThan(0);
    for (const text of [
      /根拠/,
      /元にした本物の設定/,
      /この会話で作られた設定です/,
      /本文中の位置は特定できませんでした/,
      /判定していません/,
      /話を合わせていました/,
      /会話に出てきた順に/,
      /話のつながりを図で見る/,
    ]) {
      expect(screen.queryByText(text)).toBeNull();
    }
  });

  it("嘘の部分は本文中で印が付く。印に番号は付けない", async () => {
    mocks.revealSession.mockResolvedValue(revealed({}));
    render(<RevealView sessionId="s1" />);
    expect((await screen.findAllByTestId("reveal-message")).length).toBeGreaterThan(0);
    const [shiori] = screen.getAllByTestId("reveal-message");
    const marks = shiori.querySelectorAll("mark");
    expect(Array.from(marks).map((m) => m.textContent)).toEqual(["資格を取った", "裏にレシピがある"]);
  });

  it("結果に構造図は出さない", async () => {
    mocks.revealSession.mockResolvedValue(revealed({}));
    render(<RevealView sessionId="s1" />);
    expect((await screen.findAllByTestId("reveal-message")).length).toBeGreaterThan(0);
    expect(screen.queryByText("嘘の構造図")).toBeNull();
    expect(screen.queryByTestId("reveal-graph")).toBeNull();
  });

  it("「話の答え」の一覧と「会話をふりかえる」の見出しは出さず、会話の本文だけを出す", async () => {
    mocks.revealSession.mockResolvedValue(revealed({ t1: "lie", l1: "lie" }));
    render(<RevealView sessionId="s1" />);
    expect(await screen.findByText("結論から言うとね。")).toBeTruthy();
    expect(screen.queryByText("話の答え")).toBeNull();
    expect(screen.queryByText("会話をふりかえる")).toBeNull();
    // 一覧に付いていた真偽のラベルと、予想の当たり外れも出さない
    expect(screen.queryByText("見抜いた")).toBeNull();
    expect(screen.queryByText("嘘と予想")).toBeNull();
    // 主張の引用は本文の印の中にだけ出る（一覧に同じ文を重ねて出さない）
    expect(screen.getAllByText("裏にレシピがある")).toHaveLength(1);
  });

  it("「別の会話を始める」は、スタート画面に戻らず、同じ作品で新しいセッションを作ってそのチャットに移る", async () => {
    mocks.revealSession.mockResolvedValue(revealed({}));
    mocks.createSession.mockResolvedValue({ sessionId: "s-new", openingMessage: "……今日は何について話したい?" });
    render(<RevealView sessionId="s1" />);
    fireEvent.click(await screen.findByRole("button", { name: "別の会話を始める" }));

    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith("/chat/s-new"));
    expect(mocks.createSession).toHaveBeenCalledWith("w");
    expect(screen.queryByRole("link", { name: "別の会話を始める" })).toBeNull();
  });

  it("新しいセッションの作成に失敗したら、画面を移らずにエラーを出す", async () => {
    mocks.revealSession.mockResolvedValue(revealed({}));
    mocks.createSession.mockRejectedValue(new Error("work not found"));
    render(<RevealView sessionId="s1" />);
    fireEvent.click(await screen.findByRole("button", { name: "別の会話を始める" }));

    expect(await screen.findByText("work not found")).toBeTruthy();
    expect(mocks.push).not.toHaveBeenCalled();
  });
});
