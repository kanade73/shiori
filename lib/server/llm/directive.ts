import { textIncludesAny } from "../retrieval";
import { normalizeText } from "../claims";
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

/** 直近のとしおの発話。無ければ null。 */
function lastToshioMessage(history: Message[]): Message | null {
  for (let i = history.length - 1; i >= 0; i--) {
    const m = history[i];
    if (m.role === "assistant" && m.speaker === "toshio") return m;
  }
  return null;
}

/** 直近の assistant 発話がとしおか（＝としおが割り込んだ直後のユーザー発話か）。 */
function toshioSpokeLast(history: Message[]): boolean {
  for (let i = history.length - 1; i >= 0; i--) {
    const m = history[i];
    if (m.role !== "assistant") continue;
    return m.speaker === "toshio";
  }
  return false;
}

function bigrams(text: string): Set<string> {
  const compact = normalizeText(text).replace(/[^\p{L}\p{N}]/gu, "");
  const grams = new Set<string>();
  for (let i = 0; i + 1 < compact.length; i++) grams.add(compact.slice(i, i + 2));
  return grams;
}

/** ユーザーの発話がとしおの発言を引用している（発話の bigram の大半がとしおの文に含まれる）か。 */
export const QUOTE_OVERLAP_THRESHOLD = 0.6;
export function quotesMessage(userMessage: string, message: string): boolean {
  const user = bigrams(userMessage);
  if (user.size < 8) return false;
  const target = bigrams(message);
  let hit = 0;
  for (const g of user) if (target.has(g)) hit += 1;
  return hit / user.size >= QUOTE_OVERLAP_THRESHOLD;
}

/**
 * ユーザーがとしおの考察について聞いているか。としおの直後の発話（感想だけの相槌を除く）か、
 * としおの文を引用しているとき。としおの考察はシオリの嘘の仕組みに乗っていないので、
 * ここで拾ってシオリに「支える細部を足す」指示にする。
 */
export function theoryInQuestion(params: { userMessage: string; analysis: UserMessageAnalysis; history: Message[] }): string | null {
  const { userMessage, analysis, history } = params;
  const toshio = lastToshioMessage(history);
  if (!toshio) return null;
  if (quotesMessage(userMessage, toshio.content)) return toshio.content;
  if (toshioSpokeLast(history) && analysis.questionType !== "impression") return toshio.content;
  return null;
}

export function decideDirective(params: {
  analysis: UserMessageAnalysis;
  history: Message[];
  /** ユーザーの発話。としおの考察を引用しているかを見る */
  userMessage?: string;
  /** セッションの active な嘘 全件 */
  fabricatedFacts: FabricatedFact[];
  /** retrieveFabricatedFacts の結果（言及キャラ関連が先頭） */
  relevantFacts: FabricatedFact[];
  phase: SessionPhase;
}): TurnDirective {
  const { analysis, history, fabricatedFacts, relevantFacts, phase, userMessage = "" } = params;

  const theory = theoryInQuestion({ userMessage, analysis, history });
  if (theory) return { kind: "support_theory", phase, theory };

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
