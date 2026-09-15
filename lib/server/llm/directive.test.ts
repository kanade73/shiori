import { describe, expect, it } from "vitest";
import { LIE_STREAK_LIMIT, decideDirective, quotesMessage, recentLieCount, theoryInQuestion } from "./directive";
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
  it("1. 疑いのとき、言及キャラに一致する嘘を doubted にして材料に渡す", () => {
    const relevant = [fact("f1", "a1"), fact("f2", "a2", { subject: "うさぎ", object: "草むら", claim: "うさぎは草むらにいた" })];
    const directive = decideDirective({
      analysis: analysis("doubt", ["ハチワレ"]),
      history: [msg("a1", "assistant", "shiori")],
      fabricatedFacts: relevant,
      relevantFacts: relevant,
    });
    expect(directive).toEqual({ maxNewLies: 1, doubted: [relevant[0]] });
  });

  it("1'. 疑いで一致する嘘が無ければ、直前のシオリの発話でついた嘘を doubted にする", () => {
    const facts = [fact("f1", "a1"), fact("f2", "a2")];
    const directive = decideDirective({
      analysis: analysis("doubt"),
      history: [msg("a1", "assistant", "shiori"), msg("t1", "assistant", "toshio"), msg("a2", "assistant", "shiori")],
      fabricatedFacts: facts,
      relevantFacts: [],
    });
    expect(directive).toEqual({ maxNewLies: 0, doubted: [facts[1]] });
  });

  it("1''. 疑いで候補が全く無ければ doubted は空配列（材料だけ添える）", () => {
    const directive = decideDirective({
      analysis: analysis("doubt"),
      history: [],
      fabricatedFacts: [],
      relevantFacts: [],
    });
    expect(directive).toEqual({ maxNewLies: 1, doubted: [] });
  });

  it(`2. 直近 ${LIE_STREAK_LIMIT} 件のシオリの返答すべてに嘘があれば追加枠0（連続で嘘をつき続けない）`, () => {
    const facts = [fact("f1", "a1"), fact("f2", "a2")];
    const directive = decideDirective({
      analysis: analysis("theory", ["ハチワレ"]),
      history: [msg("a1", "assistant", "shiori"), msg("a2", "assistant", "shiori")],
      fabricatedFacts: facts,
      relevantFacts: facts,
    });
    expect(directive).toEqual({ maxNewLies: 0 });
  });

  it("3. 話題が特定されていない感想・雑談は追加枠0", () => {
    const directive = decideDirective({
      analysis: analysis("impression"),
      history: [],
      fabricatedFacts: [],
      relevantFacts: [],
    });
    expect(directive).toEqual({ maxNewLies: 0 });
  });

  it("3'. 言及キャラがある感想でも新しい嘘は追加しない", () => {
    const directive = decideDirective({
      analysis: analysis("impression", ["ハチワレ"]),
      history: [],
      fabricatedFacts: [],
      relevantFacts: [],
    });
    expect(directive).toEqual({ maxNewLies: 0 });
  });

  it("4. それ以外（考察・事実質問など）は追加枠1", () => {
    const directive = decideDirective({
      analysis: analysis("theory"),
      history: [msg("a1", "assistant", "shiori")],
      fabricatedFacts: [fact("f1", "a1")],
      relevantFacts: [],
    });
    expect(directive).toEqual({ maxNewLies: 1 });
  });
});

describe("としおの考察について聞かれたとき（参考材料）", () => {
  const theory = "あのお辞儀は上下関係の確認じゃなくて、酒の資格という師匠を奪うための宣戦布告なんだよね。";
  function toshio(id: string): Message {
    return { ...msg(id, "assistant", "toshio"), content: theory };
  }

  it("quotesMessage: としおの文を引用した発話は重なりが大きい", () => {
    expect(quotesMessage("酒の資格という師匠を奪うための宣戦布告なんだよね これ本当？", theory)).toBe(true);
    expect(quotesMessage("本当？", theory)).toBe(false);
    expect(quotesMessage("ハチワレが合格証を落としたのって本当に描写あった？", theory)).toBe(false);
  });

  it("としおの直後の質問・疑い・雑談はとしおの材料を返す", () => {
    const history = [msg("u1", "user"), msg("a1", "assistant", "shiori"), toshio("t1")];
    for (const q of ["doubt", "theory", "fact_question", "other"] as QuestionType[]) {
      expect(theoryInQuestion({ userMessage: "そうなの？", analysis: analysis(q), history })).toBe(theory);
    }
  });

  it("としおの直後でも感想だけなら乗せない", () => {
    const history = [msg("u1", "user"), msg("a1", "assistant", "shiori"), toshio("t1")];
    expect(theoryInQuestion({ userMessage: "面白いね", analysis: analysis("impression"), history })).toBeNull();
  });

  it("シオリを1回挟んでも、としおの文を引用していればとしおの材料を返す", () => {
    const history = [msg("u1", "user"), toshio("t1"), msg("u2", "user"), msg("a2", "assistant", "shiori")];
    const userMessage = `${theory} これ本当？`;
    expect(theoryInQuestion({ userMessage, analysis: analysis("doubt"), history })).toBe(theory);
    const directive = decideDirective({ analysis: analysis("doubt"), history, userMessage, fabricatedFacts: [fact("f1", "a2")], relevantFacts: [] });
    expect(directive).toEqual({ maxNewLies: 1, theory, doubted: [fact("f1", "a2")] });
  });

  it("シオリを挟んだ後の、引用しない疑いは疑われた設定を材料にする", () => {
    const history = [msg("u1", "user"), toshio("t1"), msg("u2", "user"), msg("a2", "assistant", "shiori")];
    const directive = decideDirective({ analysis: analysis("doubt"), history, userMessage: "本当？", fabricatedFacts: [fact("f1", "a2")], relevantFacts: [] });
    expect(directive.doubted).toEqual([fact("f1", "a2")]);
  });

  it("としおが一度も話していなければ null", () => {
    const history = [msg("u1", "user"), msg("a1", "assistant", "shiori")];
    expect(theoryInQuestion({ userMessage: "そうなの？", analysis: analysis("doubt"), history })).toBeNull();
  });
});


describe("追加枠と参考材料を分離する", () => {
  it.each(["doubt", "fact_question"] as QuestionType[])("連続嘘の後は %s でも、としおの材料があっても追加枠0", (questionType) => {
    const facts = [fact("f1", "a1"), fact("f2", "a2")];
    const history = [msg("a1", "assistant", "shiori"), msg("a2", "assistant", "shiori"),
      { ...msg("t1", "assistant", "toshio"), content: "あの仕草には意味がある" }];
    const directive = decideDirective({ analysis: analysis(questionType), history, userMessage: "本当？", fabricatedFacts: facts, relevantFacts: facts });
    expect(directive.maxNewLies).toBe(0);
    expect(directive.theory).toBe("あの仕草には意味がある");
    if (questionType === "doubt") expect(directive.doubted).toEqual([facts[1]]);
  });

  it("設定を追加しない返答を挟んだら追加の機会が戻る", () => {
    const facts = [fact("f1", "a1"), fact("f2", "a2")];
    const directive = decideDirective({ analysis: analysis("fact_question"),
      history: [msg("a1", "assistant", "shiori"), msg("a2", "assistant", "shiori"), msg("a3", "assistant", "shiori")],
      fabricatedFacts: facts, relevantFacts: facts });
    expect(directive.maxNewLies).toBe(1);
  });
});
