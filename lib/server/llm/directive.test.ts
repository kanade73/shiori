import { describe, expect, it } from "vitest";
import {
  LAYER_DETAIL_COUNTS,
  LIE_STREAK_LIMITS,
  PHASE_THRESHOLDS,
  countUserMessages,
  decideDirective,
  decideSessionPhase,
  isSceneKnown,
  quotesMessage,
  recentLieCount,
  theoryInQuestion,
  toshioCooldownTurns,
} from "./directive";
import type { FabricatedFact, Message, QuestionType, SessionPhase, SessionTopic, UserMessageAnalysis } from "../types";

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

/** シオリの返答 n 件すべてに嘘が紐づいている履歴 */
function lieStreak(n: number): { history: Message[]; facts: FabricatedFact[] } {
  const history: Message[] = [];
  const facts: FabricatedFact[] = [];
  for (let i = 0; i < n; i++) {
    history.push(msg(`u${i}`, "user"), msg(`a${i}`, "assistant", "shiori"));
    facts.push(fact(`f${i}`, `a${i}`));
  }
  return { history, facts };
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

describe("countUserMessages", () => {
  it("ユーザーの発話だけを数える", () => {
    expect(countUserMessages([msg("u1", "user"), msg("a1", "assistant", "shiori"), msg("u2", "user")])).toBe(2);
  });
});

describe("decideSessionPhase: 嘘の件数とユーザー発話数から進行度を決める", () => {
  it("どちらも閾値未満なら early", () => {
    expect(decideSessionPhase({ fabricatedFactCount: 0, userMessageCount: 1 })).toBe("early");
  });

  it("嘘の件数だけで middle / late に上がる", () => {
    expect(decideSessionPhase({ fabricatedFactCount: PHASE_THRESHOLDS.middle.fabricatedFacts, userMessageCount: 1 })).toBe("middle");
    expect(decideSessionPhase({ fabricatedFactCount: PHASE_THRESHOLDS.late.fabricatedFacts, userMessageCount: 1 })).toBe("late");
  });

  it("嘘が出ていなくても、長く話していれば進行度は上がる", () => {
    expect(decideSessionPhase({ fabricatedFactCount: 0, userMessageCount: PHASE_THRESHOLDS.middle.userMessages })).toBe("middle");
    expect(decideSessionPhase({ fabricatedFactCount: 0, userMessageCount: PHASE_THRESHOLDS.late.userMessages })).toBe("late");
  });

  it("閾値は early < middle < late の順に並んでいる", () => {
    expect(PHASE_THRESHOLDS.middle.fabricatedFacts).toBeLessThan(PHASE_THRESHOLDS.late.fabricatedFacts);
    expect(PHASE_THRESHOLDS.middle.userMessages).toBeLessThan(PHASE_THRESHOLDS.late.userMessages);
  });
});

describe("エスカレーション: 進行度が上げるのは頻度と密度だけ", () => {
  it("連続で嘘をつける上限は進行度とともに上がり、終盤は上限なし", () => {
    expect(LIE_STREAK_LIMITS.early).toBeLessThan(LIE_STREAK_LIMITS.middle);
    expect(LIE_STREAK_LIMITS.late).toBe(Infinity);
  });

  it("裏付けに足させる細部の数は進行度とともに増える", () => {
    expect(LAYER_DETAIL_COUNTS.early).toBeLessThan(LAYER_DETAIL_COUNTS.middle);
    expect(LAYER_DETAIL_COUNTS.middle).toBeLessThan(LAYER_DETAIL_COUNTS.late);
  });

  it("としおのクールダウンは終盤に外れる（毎ターン割り込める）", () => {
    expect(toshioCooldownTurns("early")).toBeGreaterThan(0);
    expect(toshioCooldownTurns("late")).toBe(0);
  });

  it("序盤は2連続で嘘をつくと plain に落ちるが、中盤は3連続まで許す", () => {
    const { history, facts } = lieStreak(2);
    const at = (phase: SessionPhase) =>
      decideDirective({
        analysis: analysis("theory", ["ハチワレ"]),
        history,
        fabricatedFacts: facts,
        relevantFacts: facts,
        phase,
      }).kind;
    expect(at("early")).toBe("plain");
    expect(at("middle")).toBe("introduce");
  });

  it("終盤は何連続で嘘をついていても introduce のまま（毎発話 嘘を許す）", () => {
    const streak = lieStreak(6);
    const directive = decideDirective({
      analysis: analysis("theory", ["ハチワレ"]),
      history: streak.history,
      fabricatedFacts: streak.facts,
      relevantFacts: streak.facts,
      phase: "late",
    });
    expect(directive).toEqual({ kind: "introduce", phase: "late" });
  });

  it("layer の detailCount は進行度から引く", () => {
    for (const phase of ["early", "middle", "late"] as SessionPhase[]) {
      const directive = decideDirective({
        analysis: analysis("doubt"),
        history: [],
        fabricatedFacts: [],
        relevantFacts: [],
        phase,
      });
      expect(directive).toEqual({ kind: "layer", phase, doubted: [], detailCount: LAYER_DETAIL_COUNTS[phase] });
    }
  });
});

describe("decideDirective", () => {
  const phase: SessionPhase = "early";

  it("1. 疑いのとき、言及キャラに一致する嘘を doubted にして layer", () => {
    const relevant = [fact("f1", "a1"), fact("f2", "a2", { subject: "うさぎ", object: "草むら", claim: "うさぎは草むらにいた" })];
    const directive = decideDirective({
      analysis: analysis("doubt", ["ハチワレ"]),
      history: [msg("a1", "assistant", "shiori")],
      fabricatedFacts: relevant,
      relevantFacts: relevant,
      phase,
    });
    expect(directive).toEqual({ kind: "layer", phase, doubted: [relevant[0]], detailCount: LAYER_DETAIL_COUNTS.early });
  });

  it("1'. 疑いで一致する嘘が無ければ、直前のシオリの発話でついた嘘を doubted にする", () => {
    const facts = [fact("f1", "a1"), fact("f2", "a2")];
    const directive = decideDirective({
      analysis: analysis("doubt"),
      history: [msg("a1", "assistant", "shiori"), msg("t1", "assistant", "toshio"), msg("a2", "assistant", "shiori")],
      fabricatedFacts: facts,
      relevantFacts: [],
      phase,
    });
    expect(directive).toEqual({ kind: "layer", phase, doubted: [facts[1]], detailCount: LAYER_DETAIL_COUNTS.early });
  });

  it("1''. 疑いで候補が全く無ければ doubted は空配列（layer のまま）", () => {
    const directive = decideDirective({
      analysis: analysis("doubt"),
      history: [],
      fabricatedFacts: [],
      relevantFacts: [],
      phase,
    });
    expect(directive).toEqual({ kind: "layer", phase, doubted: [], detailCount: LAYER_DETAIL_COUNTS.early });
  });

  it(`2. 直近 ${LIE_STREAK_LIMITS.early} 件のシオリの返答すべてに嘘があれば plain（連続で嘘をつき続けない）`, () => {
    const facts = [fact("f1", "a1"), fact("f2", "a2")];
    const directive = decideDirective({
      analysis: analysis("theory", ["ハチワレ"]),
      history: [msg("a1", "assistant", "shiori"), msg("a2", "assistant", "shiori")],
      fabricatedFacts: facts,
      relevantFacts: facts,
      phase,
    });
    expect(directive).toEqual({ kind: "plain", phase });
  });

  it("3. 話題が特定されていない感想・雑談は plain", () => {
    const directive = decideDirective({
      analysis: analysis("impression"),
      history: [],
      fabricatedFacts: [],
      relevantFacts: [],
      phase,
    });
    expect(directive).toEqual({ kind: "plain", phase });
  });

  it("3'. 感想でも言及キャラがあれば introduce", () => {
    const directive = decideDirective({
      analysis: analysis("impression", ["ハチワレ"]),
      history: [],
      fabricatedFacts: [],
      relevantFacts: [],
      phase,
    });
    expect(directive).toEqual({ kind: "introduce", phase });
  });

  it("4. それ以外（考察・事実質問など）は introduce", () => {
    const directive = decideDirective({
      analysis: analysis("theory"),
      history: [msg("a1", "assistant", "shiori")],
      fabricatedFacts: [fact("f1", "a1")],
      relevantFacts: [],
      phase,
    });
    expect(directive).toEqual({ kind: "introduce", phase });
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

  it("としおの直後でも、としおに触れない質問・雑談は support_theory にしない（issue #30）", () => {
    const history = [msg("u1", "user"), msg("a1", "assistant", "shiori"), toshio("t1")];
    for (const userMessage of ["怖かったシーンある？", "古本屋の店主ってだれ？", "草むしりの仕事は危なくないの？", "面白いね"]) {
      expect(theoryInQuestion({ userMessage, history })).toBeNull();
    }
  });

  it("としおの直後の、としおに触れない「それ本当？」は layer", () => {
    const history = [msg("u1", "user"), msg("a1", "assistant", "shiori"), toshio("t1")];
    const facts = [fact("f1", "a1")];
    const directive = decideDirective({ analysis: analysis("doubt"), history, userMessage: "それ本当？", fabricatedFacts: facts, relevantFacts: [] });
    expect(directive).toEqual({ kind: "layer", doubted: facts });
  });

  it("としおを名指ししたら support_theory（シオリを挟んだ後でも）", () => {
    const right = [msg("u1", "user"), msg("a1", "assistant", "shiori"), toshio("t1")];
    const later = [msg("u1", "user"), toshio("t1"), msg("u2", "user"), msg("a2", "assistant", "shiori")];
    for (const history of [right, later]) {
      expect(theoryInQuestion({ userMessage: "としおの言ってたことって本当？", history })).toBe(theory);
      expect(theoryInQuestion({ userMessage: "トシオはどうしてそう思うの", history })).toBe(theory);
    }
    const directive = decideDirective({ analysis: analysis("doubt"), history: right, userMessage: "としおの考察ってどう思う？", fabricatedFacts: [], relevantFacts: [] });
    expect(directive).toEqual({ kind: "support_theory", theory });
  });

  it("「考察」はとしおの直後だけ support_theory", () => {
    const right = [msg("u1", "user"), msg("a1", "assistant", "shiori"), toshio("t1")];
    const later = [msg("u1", "user"), toshio("t1"), msg("u2", "user"), msg("a2", "assistant", "shiori")];
    expect(theoryInQuestion({ userMessage: "その考察って本当？", history: right })).toBe(theory);
    expect(theoryInQuestion({ userMessage: "その考察って本当？", history: later })).toBeNull();
  });

  it("シオリを1回挟んでも、としおの文を引用していれば support_theory", () => {
    const history = [msg("u1", "user"), toshio("t1"), msg("u2", "user"), msg("a2", "assistant", "shiori")];
    const userMessage = `${theory} これ本当？`;
    expect(theoryInQuestion({ userMessage, history })).toBe(theory);
    const directive = decideDirective({
      analysis: analysis("doubt"),
      history,
      userMessage,
      fabricatedFacts: [fact("f1", "a2")],
      relevantFacts: [],
      phase: "early",
    });
    expect(directive).toEqual({ kind: "support_theory", phase: "early", theory });
  });

  it("シオリを挟んだ後の、引用しない疑いは従来どおり layer", () => {
    const history = [msg("u1", "user"), toshio("t1"), msg("u2", "user"), msg("a2", "assistant", "shiori")];
    const directive = decideDirective({
      analysis: analysis("doubt"),
      history,
      userMessage: "本当？",
      fabricatedFacts: [fact("f1", "a2")],
      relevantFacts: [],
      phase: "early",
    });
    expect(directive.kind).toBe("layer");
  });

  it("としおが一度も話していなければ null", () => {
    const history = [msg("u1", "user"), msg("a1", "assistant", "shiori")];
    expect(theoryInQuestion({ userMessage: "としおってだれ？", history })).toBeNull();
  });
});

describe("decideDirective: 名前の誤字と別の作品（issue #1 ナックルベンチ）", () => {
  const history = [msg("u1", "user"), msg("a1", "assistant", "shiori")];
  const corrections = [{ written: "ハコワレ", entity: "ハチワレ" }];

  it("名前の誤字があれば、場面が分かっていても confirm_name（誰のことか聞き返す）", () => {
    const directive = decideDirective({
      analysis: { ...analysis("impression", ["ハチワレ"], ["草むしり検定編"]), nameCorrections: corrections },
      history,
      fabricatedFacts: [],
      relevantFacts: [],
      phase: "early",
    });
    expect(directive).toEqual({ kind: "confirm_name", phase: "early", corrections });
  });

  it("誤字の確認は、場面の聞き返し（ask_scene）より先", () => {
    const directive = decideDirective({
      analysis: { ...analysis("impression"), nameCorrections: corrections },
      history,
      fabricatedFacts: [],
      relevantFacts: [],
      phase: "early",
      sceneKnown: false,
    });
    expect(directive.kind).toBe("confirm_name");
  });

  it("別の作品の話なら other_work。誤字や疑いより先", () => {
    const otherWork = { otherWork: "HUNTER×HUNTER", names: ["ナックル", "ユピー"] };
    const directive = decideDirective({
      analysis: { ...analysis("doubt"), nameCorrections: corrections },
      history,
      fabricatedFacts: [fact("f1", "a1")],
      relevantFacts: [],
      phase: "late",
      otherWork,
    });
    expect(directive).toEqual({ kind: "other_work", phase: "late", otherWork: "HUNTER×HUNTER", names: ["ナックル", "ユピー"] });
  });

  it("誤字も別の作品も無ければ従来どおり（訂正を受け入れた「そうだった。間違えた。」は plain）", () => {
    const directive = decideDirective({
      analysis: { ...analysis("other"), nameCorrections: [], unknownNames: [] },
      history,
      fabricatedFacts: [],
      relevantFacts: [],
      phase: "early",
      otherWork: null,
    });
    expect(directive.kind).toBe("plain");
  });
});
