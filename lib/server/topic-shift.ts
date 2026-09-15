import { getArcs, getSources } from "./works";
import { loadSourceChunks, mentionedNames, rankChunks, type RankedChunk } from "./sources";
import { matchArc } from "./topic";
import { routeTopicShift } from "./llm/router";
import type { Message, SessionTopic } from "./types";

/**
 * 会話の途中の話題の切り替わり（issue #14 の続き）。2段で判定する。
 *
 * 1. ゲート（API を呼ばない）: 切り替えの言い回し・いまと別の arc への言及・いまの話題の外の
 *    段落に強く重なる、のどれかがあれば「切り替わったかもしれない」。普段の続きの発話はここで
 *    落ちるので、ほとんどの発話では API を増やさない
 * 2. 判定役（llm/router.ts、軽いモデル・小さな文脈）: 本当に切り替えか、切り替えならどんな
 *    検索語で引き直すか（指示語を解いた検索クエリ）
 *
 * 切り替えと決まったら、呼び出し側（pipeline）が組み直した検索語で lookupSessionTopic を引き直す。
 */

const SHIFT_CUE =
  /話(は|が)?(変わ|かわ)|別の話|ほかの話|他の話|違う話|話題(を)?(変え|かえ)|そういえば|ところで|次は|今度は|(の|って)話(も|が)?(し|聞き)たい|について(も)?(話し|聞き)たい|話(って|も)(あった|あるよね)|(?<!今)回って|の回(も|は|が)/;
/** いまの話題の外の段落に、これ以上の点数で重なったら切り替えを疑う（こんにちは: 2前後、場面名: 15〜30） */
const NOVEL_MIN_SCORE = 10;
/** その段落の点数が、いまの話題の段落の最高点のこれ倍を超えていたら */
const NOVEL_MARGIN = 1.5;
/** 判定役に見せる見出しの数 */
const MAX_LABELS = 5;

export type ShiftSignal = { reason: "cue" | "arc" | "chunk"; detail: string };

/** ゲート。API は呼ばない。`ranked` は発話で順位付けした外部資料の段落（bigram） */
export function detectShiftSignal(params: {
  workId: string;
  topic: SessionTopic;
  userMessage: string;
  ranked: RankedChunk[];
}): ShiftSignal | null {
  const { workId, topic, userMessage, ranked } = params;

  const cue = userMessage.match(SHIFT_CUE);
  if (cue) return { reason: "cue", detail: cue[0] };

  const arc = matchArc(getArcs(workId), [userMessage]);
  if (arc && arc.id !== topic.arcId) return { reason: "arc", detail: arc.title };

  // 旧データ（段落を覚えていない話題）では、段落の重なりでは判定しない
  if (!topic.chunkIds || topic.chunkIds.length === 0) return null;
  const top = ranked[0];
  if (!top || top.score < NOVEL_MIN_SCORE || topic.chunkIds.includes(top.chunk.id)) return null;
  const own = ranked.find((r) => topic.chunkIds!.includes(r.chunk.id))?.score ?? 0;
  if (top.score > own * NOVEL_MARGIN) return { reason: "chunk", detail: top.chunk.label || top.chunk.heading };
  return null;
}

export type TopicShift = { query: string; signal: ShiftSignal };

/**
 * 話題が切り替わったかを判定し、切り替わったなら引き直すための検索語を返す。
 * 続きなら null。外部の知識源が無い作品や、判定役の失敗でも null（いまの話題のまま続ける）。
 */
export async function detectTopicShift(params: {
  workId: string;
  workTitle: string;
  topic: SessionTopic;
  history: Message[];
  userMessage: string;
}): Promise<TopicShift | null> {
  const { workId, workTitle, topic, history, userMessage } = params;
  if (getSources(workId).length === 0) return null;

  try {
    const chunks = await loadSourceChunks(workId);
    const ranked = rankChunks(userMessage, chunks, mentionedNames(workId, userMessage));
    const signal = detectShiftSignal({ workId, topic, userMessage, ranked });
    if (!signal) return null;

    const lastReply = [...history].reverse().find((m) => m.role === "assistant" && m.speaker !== "toshio")?.content ?? null;
    const candidateLabels = Array.from(
      new Set(ranked.slice(0, MAX_LABELS * 2).map((r) => r.chunk.label || r.chunk.heading).filter(Boolean)),
    ).slice(0, MAX_LABELS);

    const route = await routeTopicShift({ workTitle, topic, lastReply, userMessage, candidateLabels });
    // 判定役を呼んだ回だけ残す（ゲートの誤検知の頻度を後から見られるように）
    console.info(`[topic-shift] ${signal.reason}:${signal.detail} → ${route.shift ? `切り替え「${route.query}」` : "続き"}`);
    if (!route.shift) return null;
    return { query: route.query || userMessage, signal };
  } catch (error) {
    console.error("話題の切り替わりの判定に失敗（いまの話題のまま続ける）:", error);
    return null;
  }
}
