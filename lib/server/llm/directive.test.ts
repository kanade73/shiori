import { describe, expect, it } from "vitest";
import { LIE_STREAK_LIMIT, decideDirective, recentLieCount } from "./directive";
import type { FabricatedFact, Message, QuestionType, UserMessageAnalysis } from "../types";

function msg(id: string, role: Message["role"], speaker?: Message["speaker"]): Message {
  return { id, sessionId: "s1", role, content: id, createdAt: "2026-01-01T00:00:00Z", speaker };
}

function fact(id: string, introducedMessageId: string, overrides: Partial<FabricatedFact> = {}): FabricatedFact {
  return {
    id,
    sessionId: "s1",
    subject: "ハチワレ",
    relation: "lives_in",
    object: "洞窟",
    negated: false,
    claim: "ハチワレは洞窟に住んでいる",
    sourceCanonFactIds: [],
    introducedMessageId,
    confidence: 0.6,
    status: "active",
    createdAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function analysis(questionType: QuestionType, characters: string[] = [], events: string[] = []): UserMessageAnalysis {
  return { mentionedCharacters: characters, mentionedEvents: events, sentiment: "neutral", questionType };
}

describe("recentLieCount: 直近のシオリの返答のうち嘘を保存したものを数える", () => {
  it("としおの発話は数に入れない", () => {
    const history = [
      msg("u1", "user"),
      msg("a1", "assistant", "shiori"),
      msg("t1", "assistant", "toshio"),
      msg("u2", "user"),
      msg("a2", "assistant", "shiori"),
    ];
    // としおを数えていれば直近2件は t1/a2 になり 1 件しか嘘が無いことになる
    expect(recentLieCount(history, [fact("f1", "a1"), fact("f2", "a2")], 2)).toBe(2);
  });

  it("嘘を保存していない返答は数えない", () => {
    const history = [msg("a1", "assistant", "shiori"), msg("a2", "assistant", "shiori")];
    expect(recentLieCount(history, [fact("f1", "a1")], 2)).toBe(1);
  });
});

describe("decideDirective", () => {
  it("1. 疑いのとき、言及キャラに一致する嘘を doubted にして layer", () => {
    const relevant = [fact("f1", "a1"), fact("f2", "a2", { subject: "うさぎ", object: "草むら", claim: "うさぎは草むらにいた" })];
    const directive = decideDirective({
      analysis: analysis("doubt", ["ハチワレ"]),
      history: [msg("a1", "assistant", "shiori")],
      fabricatedFacts: relevant,
      relevantFacts: relevant,
    });
    expect(directive).toEqual({ kind: "layer", doubted: [relevant[0]] });
  });

  it("1'. 疑いで一致する嘘が無ければ、直前のシオリの発話でついた嘘を doubted にする", () => {
    const facts = [fact("f1", "a1"), fact("f2", "a2")];
    const directive = decideDirective({
      analysis: analysis("doubt"),
      history: [msg("a1", "assistant", "shiori"), msg("t1", "assistant", "toshio"), msg("a2", "assistant", "shiori")],
      fabricatedFacts: facts,
      relevantFacts: [],
    });
    expect(directive).toEqual({ kind: "layer", doubted: [facts[1]] });
  });

  it("1''. 疑いで候補が全く無ければ doubted は空配列（layer のまま）", () => {
    const directive = decideDirective({
      analysis: analysis("doubt"),
      history: [],
      fabricatedFacts: [],
      relevantFacts: [],
    });
    expect(directive).toEqual({ kind: "layer", doubted: [] });
  });

  it(`2. 直近 ${LIE_STREAK_LIMIT} 件のシオリの返答すべてに嘘があれば plain（連続で嘘をつき続けない）`, () => {
    const facts = [fact("f1", "a1"), fact("f2", "a2")];
    const directive = decideDirective({
      analysis: analysis("theory", ["ハチワレ"]),
      history: [msg("a1", "assistant", "shiori"), msg("a2", "assistant", "shiori")],
      fabricatedFacts: facts,
      relevantFacts: facts,
    });
    expect(directive).toEqual({ kind: "plain" });
  });

  it("3. 話題が特定されていない感想・雑談は plain", () => {
    const directive = decideDirective({
      analysis: analysis("impression"),
      history: [],
      fabricatedFacts: [],
      relevantFacts: [],
    });
    expect(directive).toEqual({ kind: "plain" });
  });

  it("3'. 感想でも言及キャラがあれば introduce", () => {
    const directive = decideDirective({
      analysis: analysis("impression", ["ハチワレ"]),
      history: [],
      fabricatedFacts: [],
      relevantFacts: [],
    });
    expect(directive).toEqual({ kind: "introduce" });
  });

  it("4. それ以外（考察・事実質問など）は introduce", () => {
    const directive = decideDirective({
      analysis: analysis("theory"),
      history: [msg("a1", "assistant", "shiori")],
      fabricatedFacts: [fact("f1", "a1")],
      relevantFacts: [],
    });
    expect(directive).toEqual({ kind: "introduce" });
  });
});
