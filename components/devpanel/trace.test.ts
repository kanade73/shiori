import { describe, expect, it } from "vitest";
import { MAX_TURNS, reduceTurns, stageReached, stageSummary, type TraceTurn } from "./trace";
import type { PipelineEvent } from "@/lib/server/events";

/** パイプラインのイベントを1発話ぶんにまとめ直す純粋関数（表示は DevPanel）。 */

function ev(turnId: string, stage: Partial<PipelineEvent>): PipelineEvent {
  return { turnId, at: "2026-01-01T00:00:00Z", ...stage } as PipelineEvent;
}

function fold(events: PipelineEvent[]): TraceTurn[] {
  return events.reduce<TraceTurn[]>((acc, e) => reduceTurns(acc, e), []);
}

const analyze = ev("t1", { stage: "analyze", mentionedCharacters: ["ハチワレ"], mentionedEvents: [], questionType: "theory" });
const directive = ev("t1", { stage: "directive", kind: "introduce", phase: "early", doubted: [] });
const generate = ev("t1", { stage: "generate", attempt: 1, message: "そうだね。" });
const extract = ev("t1", {
  stage: "extract",
  attempt: 1,
  claims: [{ subject: "A", relation: "has", object: "帽子", negated: false, claim: "A は帽子を持つ", grounding: "fabricated" }],
});
const evaluate = ev("t1", { stage: "evaluate", attempt: 1, flagged: false, details: [] });

describe("reduceTurns", () => {
  it("同じ turnId のイベントを1つのターンにまとめる", () => {
    const turns = fold([ev("t1", { stage: "user", text: "これって伏線？" }), analyze, directive, generate, extract, evaluate]);
    expect(turns).toHaveLength(1);
    expect(turns[0].userText).toBe("これって伏線？");
    expect(turns[0].analyze?.mentionedCharacters).toEqual(["ハチワレ"]);
    expect(turns[0].directive?.kind).toBe("introduce");
    expect(turns[0].attempts).toHaveLength(1);
    expect(turns[0].attempts[0].claims).toHaveLength(1);
  });

  it("turnId が違えば別のターンとして積む（新しいものが末尾）", () => {
    const turns = fold([ev("t1", { stage: "user", text: "1つ目" }), ev("t2", { stage: "user", text: "2つ目" })]);
    expect(turns.map((t) => t.userText)).toEqual(["1つ目", "2つ目"]);
  });

  it("差し戻しがあれば attempt ごとに分かれ、差し戻し理由も残る", () => {
    const turns = fold([
      generate,
      extract,
      ev("t1", { stage: "evaluate", attempt: 1, flagged: true, reason: "矛盾", details: ["既存の嘘と矛盾"] }),
      ev("t1", { stage: "regenerate", reason: "既存の嘘と矛盾" }),
      ev("t1", { stage: "generate", attempt: 2, message: "やっぱりこう。" }),
      ev("t1", { stage: "extract", attempt: 2, claims: [] }),
      ev("t1", { stage: "evaluate", attempt: 2, flagged: false, details: [] }),
    ]);
    expect(turns[0].attempts.map((a) => a.attempt)).toEqual([1, 2]);
    expect(turns[0].regenerateReason).toBe("既存の嘘と矛盾");
    expect(turns[0].fallback).toBeUndefined();
  });

  it("2回とも差し戻されたら fallback が立つ", () => {
    const turns = fold([generate, ev("t1", { stage: "fallback" })]);
    expect(turns[0].fallback).toBe(true);
  });

  it("古いターンは MAX_TURNS 件までで落とす", () => {
    const events = Array.from({ length: MAX_TURNS + 3 }, (_, i) => ev(`t${i}`, { stage: "user", text: `${i}` }));
    const turns = fold(events);
    expect(turns).toHaveLength(MAX_TURNS);
    expect(turns[turns.length - 1].userText).toBe(`${MAX_TURNS + 2}`);
  });

  it("元の配列を書き換えない（React の state として渡せる）", () => {
    const before = fold([ev("t1", { stage: "user", text: "a" })]);
    const after = reduceTurns(before, analyze);
    expect(before[0].analyze).toBeUndefined();
    expect(after[0].analyze).toBeDefined();
  });
});

describe("stageReached / stageSummary", () => {
  it("届いていない段は点灯せず、サマリも無い", () => {
    const [turn] = fold([analyze]);
    expect(stageReached(turn, "analyze")).toBe(true);
    expect(stageReached(turn, "generate")).toBe(false);
    expect(stageSummary(turn, "generate")).toBeNull();
  });

  it("analyze は質問種別と言及した語、directive は指示の種類を出す", () => {
    const [turn] = fold([analyze, directive]);
    expect(stageSummary(turn, "analyze")).toBe("考察 / ハチワレ");
    expect(stageSummary(turn, "directive")).toBe("新しい設定を1つ");
  });

  it("layer の directive は裏付けの数まで出す", () => {
    const [turn] = fold([ev("t1", { stage: "directive", kind: "layer", phase: "middle", doubted: ["嘘1"], detailCount: 2 })]);
    expect(stageSummary(turn, "directive")).toBe("裏付けを重ねる（2つ）");
  });

  it("extract は件数、取り出せなければその旨、evaluate は矛盾の有無を出す", () => {
    const [ok] = fold([generate, extract, evaluate]);
    expect(stageSummary(ok, "extract")).toBe("1件");
    expect(stageSummary(ok, "evaluate")).toBe("矛盾なし");

    const [failed] = fold([generate, ev("t1", { stage: "extract", attempt: 1, claims: [], failed: true })]);
    expect(stageSummary(failed, "extract")).toBe("取り出せず");

    const [flagged] = fold([
      generate,
      ev("t1", { stage: "evaluate", attempt: 1, flagged: true, reason: "矛盾", details: ["ハチワレの住処が食い違う"] }),
    ]);
    expect(stageSummary(flagged, "evaluate")).toBe("ハチワレの住処が食い違う");
  });

  it("としおは割り込んだか、見送ったならその理由を出す", () => {
    const [in_] = fold([ev("t1", { stage: "toshio", interjected: true })]);
    expect(stageSummary(in_, "toshio")).toBe("割り込み");
    const [out] = fold([ev("t1", { stage: "toshio", interjected: false, skipped: "cooldown" })]);
    expect(stageSummary(out, "toshio")).toBe("連投防止");
  });
});
