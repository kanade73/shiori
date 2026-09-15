import { describe, expect, it } from "vitest";
import { turnsSinceLastToshio, worthAskingToshio } from "./pipeline";
import type { GenerationResult, Message, UserMessageAnalysis } from "../types";

// issue #6: としおの割り込み頻度を決める2つの純粋関数だけを切り出してテストする。
// Gemini 呼び出しを挟む runConversationPipeline 本体はここでは検証しない。

function msg(overrides: Partial<Message>): Message {
  return {
    id: "m1",
    sessionId: "s1",
    role: "assistant",
    content: "",
    createdAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function analysis(overrides: Partial<UserMessageAnalysis> = {}): UserMessageAnalysis {
  return { mentionedCharacters: [], mentionedEvents: [], sentiment: "neutral", questionType: "other", ...overrides };
}

function generation(overrides: Partial<GenerationResult> = {}): GenerationResult {
  return {
    message: "",
    strategy: "no_new_lie",
    claims: [],
    ...overrides,
  };
}

describe("turnsSinceLastToshio", () => {
  it("としおが一度も話していなければ Infinity", () => {
    const history = [msg({ role: "user" }), msg({ speaker: "shiori" })];
    expect(turnsSinceLastToshio(history)).toBe(Infinity);
  });

  it("直前がとしおなら 0", () => {
    const history = [msg({ speaker: "shiori" }), msg({ speaker: "toshio" })];
    expect(turnsSinceLastToshio(history)).toBe(0);
  });

  it("としおの後にシオリが2回話していれば 2", () => {
    const history = [msg({ speaker: "toshio" }), msg({ speaker: "shiori" }), msg({ speaker: "shiori" })];
    expect(turnsSinceLastToshio(history)).toBe(2);
  });

  it("user のメッセージはターン数に数えない", () => {
    const history = [msg({ speaker: "toshio" }), msg({ role: "user" }), msg({ speaker: "shiori" })];
    expect(turnsSinceLastToshio(history)).toBe(1);
  });
});

describe("worthAskingToshio", () => {
  it("claims があれば true", () => {
    const result = generation({ claims: [{ subject: "a", relation: "is", object: "b", negated: false, claim: "a", grounding: "canon", sourceCanonFactIds: [] }] });
    expect(worthAskingToshio(result, analysis())).toBe(true);
  });

  it("claims が無くても questionType が theory/doubt/fact_question なら true", () => {
    expect(worthAskingToshio(generation(), analysis({ questionType: "theory" }))).toBe(true);
    expect(worthAskingToshio(generation(), analysis({ questionType: "doubt" }))).toBe(true);
    expect(worthAskingToshio(generation(), analysis({ questionType: "fact_question" }))).toBe(true);
  });

  it("claims も無く、questionType が impression/other なら false", () => {
    expect(worthAskingToshio(generation(), analysis({ questionType: "impression" }))).toBe(false);
    expect(worthAskingToshio(generation(), analysis({ questionType: "other" }))).toBe(false);
  });
});
