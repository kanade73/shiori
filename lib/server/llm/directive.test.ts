import { describe, expect, it } from "vitest";
import { LIE_STREAK_LIMIT, decideDirective, isSceneKnown, quotesMessage, recentLieCount, theoryInQuestion } from "./directive";
import type { FabricatedFact, Message, QuestionType, SessionTopic, UserMessageAnalysis } from "../types";

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

describe("どの場面の話か分からないとき（ask_scene、issue #32）", () => {
  const topic: SessionTopic = { title: "草むしり検定", summary: "…", query: "草むしり検定", facts: [], sources: [], resolvedAt: "2026-01-01T00:00:00Z" };

  it("isSceneKnown: 話題の場面か、見た話数のどちらかが分かっていれば true", () => {
    expect(isSceneKnown(null, 0)).toBe(false);
    expect(isSceneKnown(undefined, 0)).toBe(false);
    expect(isSceneKnown(topic, 0)).toBe(true);
    // 話題の仕組みより前の、話数を聞いていたセッション
    expect(isSceneKnown(null, 63)).toBe(true);
  });

  it("場面が分からなければ、質問・感想・「なんでもいい」のどれでも ask_scene", () => {
    for (const q of ["theory", "fact_question", "impression", "other", "doubt"] as QuestionType[]) {
      const directive = decideDirective({ analysis: analysis(q, ["ハチワレ"]), history: [], fabricatedFacts: [], relevantFacts: [], sceneKnown: false });
      expect(directive).toEqual({ kind: "ask_scene" });
    }
  });

  it("場面が分かっていれば従来どおり（既定は分かっている扱い）", () => {
    const directive = decideDirective({ analysis: analysis("theory"), history: [], fabricatedFacts: [], relevantFacts: [], sceneKnown: true });
    expect(directive).toEqual({ kind: "introduce" });
  });
});

describe("としおの考察について聞かれたとき（support_theory）", () => {
  const theory = "あのお辞儀は上下関係の確認じゃなくて、酒の資格という師匠を奪うための宣戦布告なんだよね。";
  function toshio(id: string): Message {
    return { ...msg(id, "assistant", "toshio"), content: theory };
  }

  it("quotesMessage: としおの文を引用した発話は重なりが大きい", () => {
    expect(quotesMessage("酒の資格という師匠を奪うための宣戦布告なんだよね これ本当？", theory)).toBe(true);
    expect(quotesMessage("本当？", theory)).toBe(false);
    expect(quotesMessage("ハチワレが合格証を落としたのって本当に描写あった？", theory)).toBe(false);
  });

  it("としおの直後の質問・疑い・雑談は support_theory", () => {
    const history = [msg("u1", "user"), msg("a1", "assistant", "shiori"), toshio("t1")];
    for (const q of ["doubt", "theory", "fact_question", "other"] as QuestionType[]) {
      expect(theoryInQuestion({ userMessage: "そうなの？", analysis: analysis(q), history })).toBe(theory);
    }
  });

  it("としおの直後でも感想だけなら乗せない", () => {
    const history = [msg("u1", "user"), msg("a1", "assistant", "shiori"), toshio("t1")];
    expect(theoryInQuestion({ userMessage: "面白いね", analysis: analysis("impression"), history })).toBeNull();
  });

  it("シオリを1回挟んでも、としおの文を引用していれば support_theory", () => {
    const history = [msg("u1", "user"), toshio("t1"), msg("u2", "user"), msg("a2", "assistant", "shiori")];
    const userMessage = `${theory} これ本当？`;
    expect(theoryInQuestion({ userMessage, analysis: analysis("doubt"), history })).toBe(theory);
    const directive = decideDirective({ analysis: analysis("doubt"), history, userMessage, fabricatedFacts: [fact("f1", "a2")], relevantFacts: [] });
    expect(directive).toEqual({ kind: "support_theory", theory });
  });

  it("シオリを挟んだ後の、引用しない疑いは従来どおり layer", () => {
    const history = [msg("u1", "user"), toshio("t1"), msg("u2", "user"), msg("a2", "assistant", "shiori")];
    const directive = decideDirective({ analysis: analysis("doubt"), history, userMessage: "本当？", fabricatedFacts: [fact("f1", "a2")], relevantFacts: [] });
    expect(directive.kind).toBe("layer");
  });

  it("としおが一度も話していなければ null", () => {
    const history = [msg("u1", "user"), msg("a1", "assistant", "shiori")];
    expect(theoryInQuestion({ userMessage: "そうなの？", analysis: analysis("doubt"), history })).toBeNull();
  });
});
