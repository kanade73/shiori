import { describe, expect, it } from "vitest";
import { decideExpression } from "./expression";
import type { TurnDirective, UserMessageAnalysis } from "../types";

const analysis = (questionType: UserMessageAnalysis["questionType"]): UserMessageAnalysis => ({
  mentionedCharacters: [],
  mentionedEvents: [],
  sentiment: "neutral",
  questionType,
});
const gen = (strategy: "no_new_lie" | "introduce_small_lie" | "reinforce_existing_lie" | "admit_uncertainty") => ({ strategy });
const d = (kind: TurnDirective["kind"]): TurnDirective =>
  kind === "layer"
    ? { kind, phase: "early", doubted: [], detailCount: 1 }
    : kind === "support_theory"
      ? { kind, phase: "early", theory: "…" }
      : ({ kind, phase: "early" } as TurnDirective);

describe("decideExpression", () => {
  it("感想を語り合う回だけ wink", () => {
    expect(decideExpression({ directive: d("plain"), analysis: analysis("impression"), generation: gen("no_new_lie") })).toBe("wink");
    expect(decideExpression({ directive: d("introduce"), analysis: analysis("impression"), generation: gen("introduce_small_lie") })).toBe("wink");
  });

  it("それ以外は無表情（疑い・考察・場面の聞き返し・分からないふり）", () => {
    expect(decideExpression({ directive: d("introduce"), analysis: analysis("fact_question"), generation: gen("no_new_lie") })).toBe("neutral");
    expect(decideExpression({ directive: d("layer"), analysis: analysis("doubt"), generation: gen("no_new_lie") })).toBe("neutral");
    expect(decideExpression({ directive: d("support_theory"), analysis: analysis("impression"), generation: gen("no_new_lie") })).toBe("neutral");
    expect(decideExpression({ directive: d("ask_scene"), analysis: analysis("impression"), generation: gen("no_new_lie") })).toBe("neutral");
    expect(decideExpression({ directive: d("plain"), analysis: analysis("impression"), generation: gen("admit_uncertainty") })).toBe("neutral");
  });

  it("嘘をついたかどうかでは表情を変えない（答え合わせのヒントにしない）", () => {
    const base = { directive: d("introduce"), analysis: analysis("fact_question") };
    expect(decideExpression({ ...base, generation: gen("introduce_small_lie") })).toBe(
      decideExpression({ ...base, generation: gen("no_new_lie") }),
    );
  });
});
