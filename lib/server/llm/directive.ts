import { textIncludesAny } from "../retrieval";
import type { FabricatedFact, Message, SessionPhase, TurnDirective, UserMessageAnalysis } from "../types";

/**
 * 「今回どう答えるか」はプロンプトではなくここで決める（量と頻度はコード、
 * 中身は LLM）。LLM は呼ばない純粋関数。
 *
 * セッションが進むほど嘘は積み上がり、終盤には「これは絶対嘘だ」と気づける
 * 状態を狙う。ただしコードが決めるのは **今回重ねるか・いくつ重ねるか** だけで、
 * 嘘の内容・大きさ・方向性には一切触らない。
 */

/**
 * 進行度の境界。嘘の保存件数かユーザー発話数の **どちらかが** 届いたら次の段階に進む
 * （嘘が出にくい会話でも、長く話していれば終盤として扱う）。調整はここだけ見ればよい。
 */
export const PHASE_THRESHOLDS: Record<Exclude<SessionPhase, "early">, { fabricatedFacts: number; userMessages: number }> = {
  middle: { fabricatedFacts: 3, userMessages: 5 },
  late: { fabricatedFacts: 8, userMessages: 14 },
};

/** 連続で嘘をつく上限。直近これだけ連続で嘘を保存していたら素の返答にする。終盤は上限なし。 */
export const LIE_STREAK_LIMITS: Record<SessionPhase, number> = {
  early: 2,
  middle: 3,
  late: Infinity,
};

/** 疑われたとき（layer）に足させる裏付けの数。終盤ほど厚く盛る。 */
export const LAYER_DETAIL_COUNTS: Record<SessionPhase, number> = {
  early: 1,
  middle: 2,
  late: 3,
};

/**
 * としおが連投しないためのクールダウン（シオリの返答が何ターン挟まれば再び割り込めるか）。
 * 終盤は 0 にして、毎ターン割り込めるようにする。
 */
export const TOSHIO_COOLDOWN_TURNS: Record<SessionPhase, number> = {
  early: 2,
  middle: 2,
  late: 0,
};

export function toshioCooldownTurns(phase: SessionPhase): number {
  return TOSHIO_COOLDOWN_TURNS[phase];
}

/** 進行度ごとの上限値をひとまとめに。開発者モードのパネルに流す用（値の正は上の定数）。 */
export type PhaseLimits = {
  /** 連続で嘘をつける上限。上限なしは null（JSON に Infinity を載せられない） */
  lieStreakLimit: number | null;
  layerDetailCount: number;
  toshioCooldownTurns: number;
};

export function phaseLimits(phase: SessionPhase): PhaseLimits {
  const streak = LIE_STREAK_LIMITS[phase];
  return {
    lieStreakLimit: Number.isFinite(streak) ? streak : null,
    layerDetailCount: LAYER_DETAIL_COUNTS[phase],
    toshioCooldownTurns: TOSHIO_COOLDOWN_TURNS[phase],
  };
}

/** 今回の発話を含むユーザー発話数。history が打ち切られている場合は呼び出し側が実数を渡す。 */
export function countUserMessages(history: Message[]): number {
  return history.filter((m) => m.role === "user").length;
}

/** セッションの進行度。純粋関数。 */
export function decideSessionPhase(params: { fabricatedFactCount: number; userMessageCount: number }): SessionPhase {
  const { fabricatedFactCount, userMessageCount } = params;
  const reached = (t: { fabricatedFacts: number; userMessages: number }) =>
    fabricatedFactCount >= t.fabricatedFacts || userMessageCount >= t.userMessages;

  if (reached(PHASE_THRESHOLDS.late)) return "late";
  if (reached(PHASE_THRESHOLDS.middle)) return "middle";
  return "early";
}

/** history を後ろから見て、シオリ（としお以外）の返答を最大 n 件。 */
function recentShioriMessages(history: Message[], n: number): Message[] {
  const found: Message[] = [];
  for (let i = history.length - 1; i >= 0 && found.length < n; i--) {
    const m = history[i];
    if (m.role !== "assistant") continue;
    if (m.speaker === "toshio") continue;
    found.push(m);
  }
  return found;
}

/** 直近のシオリの返答 n 件のうち、嘘を保存したものの数。 */
export function recentLieCount(history: Message[], facts: FabricatedFact[], n: number): number {
  const recent = recentShioriMessages(history, n);
  return recent.filter((m) => facts.some((f) => f.introducedMessageId === m.id)).length;
}

export function decideDirective(params: {
  analysis: UserMessageAnalysis;
  history: Message[];
  /** セッションの active な嘘 全件 */
  fabricatedFacts: FabricatedFact[];
  /** retrieveFabricatedFacts の結果（言及キャラ関連が先頭） */
  relevantFacts: FabricatedFact[];
  phase: SessionPhase;
}): TurnDirective {
  const { analysis, history, fabricatedFacts, relevantFacts, phase } = params;

  if (analysis.questionType === "doubt") {
    const keywords = [...analysis.mentionedCharacters, ...analysis.mentionedEvents];
    let doubted = relevantFacts.filter(
      (f) => keywords.length > 0 && textIncludesAny(`${f.subject} ${f.object} ${f.claim}`, keywords),
    );
    if (doubted.length === 0) {
      // 何を疑われたか特定できないときは、直前のシオリの発話でついた嘘を候補にする。
      const [last] = recentShioriMessages(history, 1);
      doubted = last ? fabricatedFacts.filter((f) => f.introducedMessageId === last.id) : [];
    }
    return { kind: "layer", phase, doubted, detailCount: LAYER_DETAIL_COUNTS[phase] };
  }

  const streakLimit = LIE_STREAK_LIMITS[phase];
  if (Number.isFinite(streakLimit) && recentLieCount(history, fabricatedFacts, streakLimit) >= streakLimit) {
    return { kind: "plain", phase };
  }

  if (
    (analysis.questionType === "impression" || analysis.questionType === "other") &&
    analysis.mentionedCharacters.length === 0 &&
    analysis.mentionedEvents.length === 0
  ) {
    return { kind: "plain", phase };
  }

  return { kind: "introduce", phase };
}
