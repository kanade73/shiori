import { textIncludesAny } from "../retrieval";
import { normalizeText } from "../claims";
import type { FabricatedFact, Message, TurnDirective, UserMessageAnalysis } from "../types";

/**
 * 「今回どう答えるか」はプロンプトではなくここで決める（量と頻度はコード、
 * 中身は LLM）。LLM は呼ばない純粋関数。
 */

/** 連続で嘘をつき続けないための上限。直近これだけ連続で嘘を保存していたら素の返答にする。 */
export const LIE_STREAK_LIMIT = 2;

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

/** 発話がとしおを名指ししているか。 */
const TOSHIO_NAME = /としお|トシオ/;
/** としおの直後にこれを言ったら、としおの考察のことを聞いているとみなす。 */
const THEORY_WORD = /考察/;

/**
 * ユーザーがとしおの考察について聞いているか。としおの文を引用したとき・としおを名指ししたとき・
 * としおの直後に「考察」と言ったときだけ。としおの直後というだけでは拾わない（普通の質問や
 * 「それ本当？」までとしおの話にされ、質問に答えず・疑いの layer も出なくなるため。issue #30）。
 * としおの考察はシオリの嘘の仕組みに乗っていないので、ここで拾ってシオリに「支える細部を足す」指示にする。
 */
export function theoryInQuestion(params: { userMessage: string; history: Message[] }): string | null {
  const { userMessage, history } = params;
  const toshio = lastToshioMessage(history);
  if (!toshio) return null;
  if (quotesMessage(userMessage, toshio.content)) return toshio.content;
  const text = normalizeText(userMessage);
  if (TOSHIO_NAME.test(text)) return toshio.content;
  if (toshioSpokeLast(history) && THEORY_WORD.test(text)) return toshio.content;
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
}): TurnDirective {
  const { analysis, history, fabricatedFacts, relevantFacts, userMessage = "" } = params;
  const theory = theoryInQuestion({ userMessage, history });
  if (theory) return { kind: "support_theory", theory };

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
    return { kind: "layer", doubted };
  }

  if (recentLieCount(history, fabricatedFacts, LIE_STREAK_LIMIT) >= LIE_STREAK_LIMIT) {
    return { kind: "plain" };
  }

  if (
    (analysis.questionType === "impression" || analysis.questionType === "other") &&
    analysis.mentionedCharacters.length === 0 &&
    analysis.mentionedEvents.length === 0
  ) {
    return { kind: "plain" };
  }

  return { kind: "introduce" };
}
