import { describe, expect, it, vi } from "vitest";
import {
  createTurnEmitter,
  emitPipelineEvent,
  pipelineEventListenerCount,
  subscribePipelineEvents,
  type PipelineEvent,
} from "./events";

/**
 * 開発者モードのパネル用イベントバス。セッションごとに分かれること、購読が解除できること、
 * そして「購読者が居なくても emit が壊れない」（会話は常に先に通る）ことを固定する。
 */

function event(overrides: Partial<PipelineEvent> = {}): PipelineEvent {
  return { turnId: "t1", at: "2026-01-01T00:00:00Z", stage: "fallback", ...overrides } as PipelineEvent;
}

describe("subscribePipelineEvents", () => {
  it("購読したセッションのイベントだけを受け取る", () => {
    const s1 = vi.fn();
    const s2 = vi.fn();
    const off1 = subscribePipelineEvents("s1", s1);
    const off2 = subscribePipelineEvents("s2", s2);

    emitPipelineEvent("s1", event({ stage: "user", text: "こんにちは" } as Partial<PipelineEvent>));

    expect(s1).toHaveBeenCalledTimes(1);
    expect(s2).not.toHaveBeenCalled();
    expect(s1.mock.calls[0][0]).toMatchObject({ stage: "user", text: "こんにちは", turnId: "t1" });

    off1();
    off2();
  });

  it("解除すると以降は届かない", () => {
    const listener = vi.fn();
    const off = subscribePipelineEvents("s3", listener);
    emitPipelineEvent("s3", event());
    off();
    emitPipelineEvent("s3", event());

    expect(listener).toHaveBeenCalledTimes(1);
    expect(pipelineEventListenerCount("s3")).toBe(0);
  });

  it("同じセッションを複数のタブが購読しても全員に届く", () => {
    const a = vi.fn();
    const b = vi.fn();
    const offA = subscribePipelineEvents("s4", a);
    const offB = subscribePipelineEvents("s4", b);

    emitPipelineEvent("s4", event());

    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
    offA();
    offB();
  });

  it("[パイプラインを止めない] 購読者が一人も居なくても emit は例外にならない", () => {
    expect(() => emitPipelineEvent("nobody", event())).not.toThrow();
  });
});

describe("createTurnEmitter", () => {
  it("turnId と時刻を埋めて流す（1発話ぶんが同じ turnId でまとまる）", () => {
    const listener = vi.fn();
    const off = subscribePipelineEvents("s5", listener);
    const emit = createTurnEmitter("s5", "turn-9");

    emit({ stage: "analyze", mentionedCharacters: ["A"], mentionedEvents: [], questionType: "theory" });
    emit({ stage: "evaluate", attempt: 1, flagged: false, details: [] });

    const received = listener.mock.calls.map((c) => c[0] as PipelineEvent);
    expect(received.map((e) => e.turnId)).toEqual(["turn-9", "turn-9"]);
    expect(received.map((e) => e.stage)).toEqual(["analyze", "evaluate"]);
    expect(typeof received[0].at).toBe("string");
    off();
  });
});
