import { textIncludesAny } from "../retrieval";
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

export function decideDirective(params: {
  analysis: UserMessageAnalysis;
  history: Message[];
  /** セッションの active な嘘 全件 */
  fabricatedFacts: FabricatedFact[];
  /** retrieveFabricatedFacts の結果（言及キャラ関連が先頭） */
  relevantFacts: FabricatedFact[];
}): TurnDirective {
  const { analysis, history, fabricatedFacts, relevantFacts } = params;

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
