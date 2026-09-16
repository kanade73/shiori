import { getCanonFactsUpTo } from "./works";
import { getFabricatedFacts } from "./store";
import type { CanonFact, ChatSession, FabricatedFact, UserMessageAnalysis } from "./types";

const MAX_CANON_FACTS = 6;
// 生成に渡す既存の嘘の上限。矛盾の防止はプロンプトではなく evaluate（全件と照合）が
// 担うので、ここは「話の続きを作る材料」として関係する数件だけ渡す。全件を渡すと
// セッションが長くなるほどモデルが自己監視に寄り、嘘をつかなくなる。
const MAX_FABRICATED_FACTS_FOR_PROMPT = 8;

/** 語のいずれかが text に含まれるか（大文字小文字を無視）。関連判定の共通ルール。 */
export function textIncludesAny(text: string, needles: string[]): boolean {
  const lower = text.toLowerCase();
  return needles.some((needle) => needle.trim().length > 0 && lower.includes(needle.toLowerCase()));
}

/** セッションで話した全部の話題（切り替わる前のものも）について、外部の資料で確かめた事実 */
export function getTopicFacts(session: Pick<ChatSession, "topic" | "pastTopics">): CanonFact[] {
  return [...(session.topic?.facts ?? []), ...(session.pastTopics ?? []).flatMap((t) => t.facts)];
}

/**
 * セッションで見せてよい本物の設定の全部: 話題の場面について外部の資料で確かめたもの
 * （issue #14。切り替わる前の話題の分も）と、work.json のうち視聴済み範囲のもの。
 * 答え合わせの根拠や debug 画面に使う。
 */
export function getVisibleCanonFacts(
  session: Pick<ChatSession, "workId" | "currentEpisode" | "topic" | "pastTopics">,
): CanonFact[] {
  return [...getTopicFacts(session), ...getCanonFactsUpTo(session.workId, session.currentEpisode)];
}

/**
 * Naive keyword-overlap retrieval instead of embeddings/pgvector - acceptable
 * per docs/specs/mvp-spec.md section 5 for an early/hackathon build. Never returns facts
 * beyond the viewer's current episode (spoilerLevel <= currentEpisode).
 *
 * `topicFacts` (the scene the user picked at the start, issue #14) always come
 * first and are not counted against the cap: they are what this session is about.
 */
export function retrieveCanonFacts(
  workId: string,
  currentEpisode: number,
  analysis: UserMessageAnalysis,
  topicFacts: CanonFact[] = [],
): CanonFact[] {
  return [...topicFacts, ...retrieveWorkCanonFacts(workId, currentEpisode, analysis)];
}

function retrieveWorkCanonFacts(workId: string, currentEpisode: number, analysis: UserMessageAnalysis): CanonFact[] {
  const visible = getCanonFactsUpTo(workId, currentEpisode);
  const keywords = [...analysis.mentionedCharacters, ...analysis.mentionedEvents];

  if (keywords.length === 0) {
    return visible.sort((a, b) => b.episodeFrom - a.episodeFrom).slice(0, MAX_CANON_FACTS);
  }

  const scored = visible.map((fact) => {
    const haystack = `${fact.subject} ${fact.object} ${fact.description}`;
    const score = keywords.filter((k) => textIncludesAny(haystack, [k])).length;
    return { fact, score };
  });

  const withScore = scored.filter((s) => s.score > 0);
  const pool = withScore.length > 0 ? withScore : scored;

  return pool
    .sort((a, b) => b.score - a.score || b.fact.episodeFrom - a.fact.episodeFrom)
    .slice(0, MAX_CANON_FACTS)
    .map((s) => s.fact);
}

/** Every active lie in the session. This is what evaluate checks against. */
export async function getActiveFabricatedFacts(sessionId: string): Promise<FabricatedFact[]> {
  return (await getFabricatedFacts(sessionId)).filter((fact) => fact.status === "active");
}

/**
 * The few lies worth reminding the character of for this turn: the ones about
 * mentioned entities, newest first, topped up with the most recent ones.
 */
export async function retrieveFabricatedFacts(
  sessionId: string,
  analysis?: UserMessageAnalysis,
): Promise<FabricatedFact[]> {
  const keywords = analysis ? [...analysis.mentionedCharacters, ...analysis.mentionedEvents] : [];
  const relevance = (fact: FabricatedFact) =>
    keywords.length > 0 && textIncludesAny(`${fact.subject} ${fact.object} ${fact.claim}`, keywords) ? 1 : 0;

  return (await getActiveFabricatedFacts(sessionId))
    .sort((a, b) => relevance(b) - relevance(a) || b.createdAt.localeCompare(a.createdAt))
    .slice(0, MAX_FABRICATED_FACTS_FOR_PROMPT);
}
