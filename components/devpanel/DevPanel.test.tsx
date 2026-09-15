import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { DevPanel } from "./DevPanel";
import type { DevEventsGraph, DevEventsInit, PipelineEvent } from "@/lib/server/events";

/**
 * 開発者モードのパネル。debug 専用の SSE から届いたものだけを出すこと
 * （進行度・各段の点灯・育つ嘘のグラフ）を固定する。SSE は差し替える。
 */

type Handler = (event: MessageEvent) => void;

/** jsdom には EventSource が無いので、テストから叩ける最小の代役を置く */
class FakeEventSource {
  static last: FakeEventSource | null = null;
  handlers = new Map<string, Handler[]>();
  closed = false;

  constructor(public url: string) {
    FakeEventSource.last = this;
  }
  addEventListener(type: string, handler: Handler) {
    this.handlers.set(type, [...(this.handlers.get(type) ?? []), handler]);
  }
  close() {
    this.closed = true;
  }
  /** サーバーから1件届いたことにする */
  emit(type: string, data: unknown) {
    act(() => {
      for (const h of this.handlers.get(type) ?? []) h({ data: JSON.stringify(data) } as MessageEvent);
    });
  }
}

const init: DevEventsInit = {
  phase: "early",
  limits: { lieStreakLimit: 2, layerDetailCount: 1, toshioCooldownTurns: 2 },
  fabricatedFactCount: 0,
  userMessageCount: 0,
  graph: { nodes: [], edges: [] },
};

function stage(overrides: Partial<PipelineEvent>): PipelineEvent {
  return { turnId: "t1", at: "2026-01-01T00:00:00Z", ...overrides } as PipelineEvent;
}

function source(): FakeEventSource {
  return FakeEventSource.last!;
}

beforeEach(() => {
  FakeEventSource.last = null;
  vi.stubGlobal("EventSource", FakeEventSource);
  Element.prototype.scrollTo = vi.fn();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("DevPanel: 接続と進行度", () => {
  it("そのセッションの debug 専用 SSE に繋ぐ", () => {
    render(<DevPanel sessionId="s1" onClose={() => {}} />);
    expect(source().url).toBe("/api/sessions/s1/events");
  });

  it("閉じると SSE も切る", () => {
    const { unmount } = render(<DevPanel sessionId="s1" onClose={() => {}} />);
    const es = source();
    unmount();
    expect(es.closed).toBe(true);
  });

  it("init の進行度と、その段階の上限値を出す", async () => {
    render(<DevPanel sessionId="s1" onClose={() => {}} />);
    source().emit("init", init);

    await waitFor(() => expect(screen.getByTestId("phase-gauge").getAttribute("data-phase")).toBe("early"));
    expect(screen.getByText("序盤")).toBeTruthy();
    expect(screen.getByText("2ターン")).toBeTruthy(); // としおの間隔
  });

  it("終盤は連続嘘の上限を「なし」と出す", async () => {
    render(<DevPanel sessionId="s1" onClose={() => {}} />);
    source().emit("init", {
      ...init,
      phase: "late",
      limits: { lieStreakLimit: null, layerDetailCount: 3, toshioCooldownTurns: 0 },
    } satisfies DevEventsInit);

    await waitFor(() => expect(screen.getByTestId("phase-gauge").getAttribute("data-phase")).toBe("late"));
    expect(screen.getByText("なし")).toBeTruthy();
  });

  it("閉じるボタンで呼び出し側に知らせる", () => {
    const onClose = vi.fn();
    render(<DevPanel sessionId="s1" onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "閉じる" }));
    expect(onClose).toHaveBeenCalled();
  });
});

describe("DevPanel: パイプラインの流れ", () => {
  it("段が届くたびに点灯し、まだの段は点灯しない", async () => {
    render(<DevPanel sessionId="s1" onClose={() => {}} />);
    source().emit("init", init);
    source().emit("stage", stage({ stage: "user", text: "これって伏線？" }));
    source().emit("stage", stage({ stage: "analyze", mentionedCharacters: ["ハチワレ"], mentionedEvents: [], questionType: "theory" }));

    await waitFor(() => expect(screen.getByTestId("stage-analyze").getAttribute("data-lit")).toBe("true"));
    expect(screen.getByTestId("stage-generate").getAttribute("data-lit")).toBe("false");
    expect(screen.getByText("考察 / ハチワレ")).toBeTruthy();
    expect(screen.getByText("これって伏線？")).toBeTruthy();
  });

  it("取り出した三つ組を canon / fabricated で色分けして並べる", async () => {
    render(<DevPanel sessionId="s1" onClose={() => {}} />);
    source().emit("init", init);
    source().emit("stage", stage({ stage: "generate", attempt: 1, message: "そうだね。" }));
    source().emit(
      "stage",
      stage({
        stage: "extract",
        attempt: 1,
        claims: [
          { subject: "A", relation: "has", object: "帽子", negated: false, claim: "A は帽子を持つ", grounding: "fabricated" },
          { subject: "A", relation: "likes", object: "B", negated: false, claim: "A は B が好き", grounding: "canon" },
        ],
      }),
    );

    const chips = await screen.findByTestId("turn-claims");
    expect(chips.textContent).toContain("A は帽子を持つ");
    expect(chips.textContent).toContain("A は B が好き");
    expect(chips.querySelectorAll(".text-error")).toHaveLength(1);
    expect(chips.querySelectorAll(".text-success")).toHaveLength(1);
  });

  it("差し戻しがあれば理由を出す", async () => {
    render(<DevPanel sessionId="s1" onClose={() => {}} />);
    source().emit("init", init);
    source().emit("stage", stage({ stage: "regenerate", reason: "既存の嘘と矛盾する" }));

    await waitFor(() => expect(screen.getByTestId("turn-regenerate").textContent).toContain("既存の嘘と矛盾する"));
  });

  it("新しいターンが来ると、そちらが先頭に開いて並ぶ", async () => {
    render(<DevPanel sessionId="s1" onClose={() => {}} />);
    source().emit("init", init);
    source().emit("stage", stage({ turnId: "t1", stage: "user", text: "1つ目" }));
    source().emit("stage", stage({ turnId: "t2", stage: "user", text: "2つ目" }));

    await waitFor(() => expect(screen.getAllByTestId("turn-trace")).toHaveLength(2));
    const [first] = screen.getAllByTestId("turn-trace");
    expect(first.textContent).toContain("2つ目");
  });
});

describe("DevPanel: 育つ嘘のグラフ", () => {
  const graphEvent: DevEventsGraph = {
    graph: {
      nodes: [
        { id: "statement:ff-1", kind: "statement", statementId: "ff-1", verdict: "lie", label: "A は帽子を持つ", number: 1 },
        { id: "entity:a", kind: "entity", label: "A", known: true },
      ],
      edges: [{ id: "subject:ff-1", from: "entity:a", to: "statement:ff-1", kind: "subject", label: "持つ" }],
    },
    newFactIds: ["ff-1"],
    phase: "middle",
    limits: { lieStreakLimit: 3, layerDetailCount: 2, toshioCooldownTurns: 2 },
    fabricatedFactCount: 1,
  };

  it("嘘がまだ無ければ図は出さない", async () => {
    render(<DevPanel sessionId="s1" onClose={() => {}} />);
    source().emit("init", init);
    await waitFor(() => expect(screen.getByText("嘘はまだありません。")).toBeTruthy());
  });

  it("嘘が保存されたら図を描き、増えたノードを強調し、進行度も更新する", async () => {
    render(<DevPanel sessionId="s1" onClose={() => {}} />);
    source().emit("init", init);
    source().emit("graph", graphEvent);

    const graph = await screen.findByTestId("reveal-graph");
    expect(graph.querySelectorAll('[data-highlighted="true"]')).toHaveLength(1);
    expect(screen.getByTestId("phase-gauge").getAttribute("data-phase")).toBe("middle");
    expect(screen.getByText("1件")).toBeTruthy();
  });
});
