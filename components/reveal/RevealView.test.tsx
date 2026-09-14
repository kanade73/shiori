import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { RevealData } from "@/lib/server/reveal/types";

// 答え合わせ画面: 予想 → 答えを見る → 真偽つきの会話、の流れを固定する。API は差し替える。
const mocks = vi.hoisted(() => ({
  getSessionData: vi.fn(),
  getReveal: vi.fn(),
  submitReveal: vi.fn(),
}));
vi.mock("@/lib/client/api", () => mocks);

import { RevealView } from "./RevealView";

const work = { id: "w", title: "テスト作品", createdAt: "" };
const session = { id: "s1", workId: "w", currentEpisode: 3, createdAt: "", updatedAt: "" };
const at = "2026-09-14T12:00:00.000Z";

const pending: RevealData = {
  status: "pending",
  questions: [
    { id: "t1", speaker: "shiori", text: "資格を取った", createdAt: at },
    { id: "l1", speaker: "shiori", text: "裏にレシピがある", createdAt: at },
  ],
};

function revealed(guesses: Record<string, "true" | "lie">): RevealData {
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
  it("答え合わせ前は問題だけを出し、真偽は出さない", async () => {
    mocks.getReveal.mockResolvedValue(pending);
    render(<RevealView sessionId="s1" />);
    expect(await screen.findByText("どれが嘘だったと思う？")).toBeTruthy();
    expect(screen.getByText("「裏にレシピがある」")).toBeTruthy();
    expect(screen.getByText("2件中 0件 予想済み")).toBeTruthy();
    expect(screen.getByRole("button", { name: "予想しないで答えを見る" })).toBeTruthy();
    expect(screen.queryByText("見抜いた")).toBeNull();
  });

  it("予想して答えを見ると、予想を送り、結果（正解数・見抜いた/疑いすぎ・としおの前提）を出す", async () => {
    mocks.getReveal.mockResolvedValue(pending);
    mocks.submitReveal.mockResolvedValue(revealed({ t1: "lie", l1: "lie" }));
    render(<RevealView sessionId="s1" />);

    fireEvent.click(within(await screen.findByRole("group", { name: "1番の予想" })).getByRole("button", { name: "嘘" }));
    fireEvent.click(within(screen.getByRole("group", { name: "2番の予想" })).getByRole("button", { name: "嘘" }));
    expect(screen.getByText("2件中 2件 予想済み")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "答えを見る" }));

    expect(await screen.findByText("会話をふりかえる")).toBeTruthy();
    expect(mocks.submitReveal).toHaveBeenCalledWith("s1", { t1: "lie", l1: "lie" });
    expect(screen.getByText("2件中 1件正解")).toBeTruthy();
    expect(screen.getAllByText("見抜いた").length).toBeGreaterThan(0);
    expect(screen.getAllByText("嘘と予想").length).toBeGreaterThan(0);
    expect(screen.getByText("根拠: 第7話〜 検定に合格した")).toBeTruthy();
    expect(screen.getByText("この会話で作られた設定です。")).toBeTruthy();
    expect(screen.getByText("が嘘だと知ったうえで、話を合わせていました。", { exact: false })).toBeTruthy();
  });

  it("同じボタンをもう一度押すと予想を取り消せる", async () => {
    mocks.getReveal.mockResolvedValue(pending);
    render(<RevealView sessionId="s1" />);
    const group = await screen.findByRole("group", { name: "1番の予想" });
    const lie = within(group).getByRole("button", { name: "嘘" });
    fireEvent.click(lie);
    expect(lie.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(lie);
    expect(lie.getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByText("2件中 0件 予想済み")).toBeTruthy();
  });

  it("答え合わせ済みなら、開いた時点で結果を出す（嘘の部分は本文中で印が付く）", async () => {
    mocks.getReveal.mockResolvedValue(revealed({}));
    render(<RevealView sessionId="s1" />);
    expect(await screen.findByText("会話をふりかえる")).toBeTruthy();
    const [shiori] = screen.getAllByTestId("reveal-message");
    const marks = shiori.querySelectorAll("mark");
    expect(Array.from(marks).map((m) => m.textContent)).toEqual(["資格を取った1", "裏にレシピがある2"]);
    expect(screen.queryByRole("button", { name: /答えを見る/ })).toBeNull();
  });

  it("結果には嘘の構造図が付き、主張のノードを押すとふりかえりの該当箇所へ飛ぶ", async () => {
    mocks.getReveal.mockResolvedValue(revealed({}));
    render(<RevealView sessionId="s1" />);
    expect(await screen.findByText("嘘の構造図")).toBeTruthy();
    fireEvent.click(screen.getByText("話のつながりを図で見る"));
    const graph = screen.getByTestId("reveal-graph");
    expect(graph.querySelectorAll("[data-node-kind='statement']").length).toBe(2);
    expect(graph.querySelectorAll("[data-node-kind='entity']").length).toBe(1);
    expect(graph.querySelectorAll("[data-node-kind='canon']").length).toBe(1);
    expect(graph.querySelectorAll("[data-node-kind='toshio']").length).toBe(1);
    expect(graph.querySelector("svg text")?.closest("svg")?.textContent).toContain("持つ");

    const scrollIntoView = vi.fn();
    const target = document.getElementById("statement-l1")!;
    expect(target).toBeTruthy();
    target.scrollIntoView = scrollIntoView;
    fireEvent.click(within(graph).getByRole("button", { name: /2\. 嘘: 資格証の裏にレシピがある/ }));
    expect(scrollIntoView).toHaveBeenCalled();
  });

  it("主張が無ければ構造図は出さない", async () => {
    const data = revealed({});
    if (data.status !== "revealed") throw new Error("unreachable");
    mocks.getReveal.mockResolvedValue({ ...data, statements: [], graph: { nodes: [], edges: [] } });
    render(<RevealView sessionId="s1" />);
    expect(await screen.findByText("会話をふりかえる")).toBeTruthy();
    expect(screen.queryByText("嘘の構造図")).toBeNull();
  });
});
