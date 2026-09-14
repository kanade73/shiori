import { getCanonFactsUpTo } from "./works";
import { getFabricatedFacts } from "./store";
import type { CanonFact, FabricatedFact, UserMessageAnalysis } from "./types";

const MAX_CANON_FACTS = 6;
const MAX_FABRICATED_FACTS = 8;

function textIncludesAny(text: string, needles: string[]): boolean {
  const lower = text.toLowerCase();
  return needles.some((needle) => needle.trim().length > 0 && lower.includes(needle.toLowerCase()));
}

/**
 * Naive keyword-overlap retrieval instead of embeddings/pgvector - acceptable
 * per docs/specs/mvp-spec.md section 5 for an early/hackathon build. Never returns facts
 * beyond the viewer's current episode (spoilerLevel <= currentEpisode).
 */
export function retrieveCanonFacts(workId: string, currentEpisode: number, analysis: UserMessageAnalysis): CanonFact[] {
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

export function retrieveFabricatedFacts(sessionId: string): FabricatedFact[] {
  return getFabricatedFacts(sessionId)
    .filter((fact) => fact.status === "active")
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, MAX_FABRICATED_FACTS);
}
