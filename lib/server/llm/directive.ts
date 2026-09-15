import { textIncludesAny } from "../retrieval";
import { normalizeText } from "../claims";
import type { FabricatedFact, Message, TurnDirective, UserMessageAnalysis } from "../types";

/**
 * 新しい嘘を追加できる機会と上限を決める。応答の仕方や追加するかは LLM に任せる。
 * 疑い・としおへの言及は材料として添え、追加枠を飛び越える指示にしない。
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

/**
 * ユーザーがとしおの考察について聞いているか。としおの直後の発話（感想だけの相槌を除く）か、
 * としおの文を引用しているとき。としおの考察はシオリの嘘の仕組みに乗っていないので、
 * ここで関連する可能性のある材料として拾う。実際の応じ方はシオリが選ぶ。
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
}): TurnDirective {
  const { analysis, history, fabricatedFacts, relevantFacts, userMessage = "" } = params;
  const theory = theoryInQuestion({ userMessage, analysis, history });
  const resting = recentLieCount(history, fabricatedFacts, LIE_STREAK_LIMIT) >= LIE_STREAK_LIMIT;
  const impression = analysis.questionType === "impression";
  const smallTalk = analysis.questionType === "other" &&
    analysis.mentionedCharacters.length === 0 && analysis.mentionedEvents.length === 0;
  const directive: TurnDirective = { maxNewLies: resting || impression || smallTalk ? 0 : 1 };
  if (theory) directive.theory = theory;

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
    directive.doubted = doubted;
  }

  return directive;
}
