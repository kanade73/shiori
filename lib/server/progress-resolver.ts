import { getAllCanonFacts, getAllEpisodes, getArcs } from "./works";
import type { ProgressCandidate, ProgressResolution } from "./types";

const MAX_CANDIDATES = 5;

// Higher = more specific / more trustworthy match.
const KIND_PRIORITY: Record<ProgressCandidate["matchedVia"], number> = {
  scene: 3,
  arc: 2,
  episode: 1,
};

function splitNames(field: string): string[] {
  return field
    .split(/[、,]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function countSubstringMatches(input: string, needles: string[]): number {
  return needles.filter((needle) => needle.length > 0 && input.includes(needle)).length;
}

/**
 * Resolves a free-text viewing-progress description ("幻影旅団編を全部見た",
 * "クラピカとウボォーギンの戦いのところ") to a candidate episode boundary.
 *
 * This is a keyword-overlap heuristic, not an LLM call - kept deliberately
 * swappable: callers only depend on this function's signature, so it can be
 * replaced with an LLM-based resolver later (needed once this app covers
 * more than one hand-authored work) without touching call sites.
 */
export function resolveViewingProgress(workId: string, description: string): ProgressResolution {
  const input = description.trim();
  if (!input) return { candidates: [], bestGuess: null };

  const candidates = new Map<string, ProgressCandidate>();

  const upsert = (key: string, candidate: ProgressCandidate) => {
    const existing = candidates.get(key);
    if (!existing || candidate.score > existing.score) {
      candidates.set(key, candidate);
    }
  };

  // Scene-level: a canon fact whose subject AND object are both named in
  // the input is the strongest, most specific signal of where the viewer is.
  for (const fact of getAllCanonFacts(workId)) {
    const names = [...splitNames(fact.subject), ...splitNames(fact.object)];
    const score = countSubstringMatches(input, names);
    if (score >= 2) {
      const episode = getAllEpisodes(workId).find(
        (ep) => ep.episodeNumber === fact.episodeFrom,
      );
      upsert(`scene-${fact.episodeFrom}`, {
        episodeNumber: fact.episodeFrom,
        label: episode?.title ? `第${fact.episodeFrom}話（${episode.title}）` : `第${fact.episodeFrom}話`,
        matchedVia: "scene",
        score,
      });
    }
  }

  // Arc-level: "〜編を見た" style descriptions. Treated as "watched through
  // the end of the arc" - the common phrasing in the examples this is built for.
  for (const arc of getArcs(workId)) {
    const score = countSubstringMatches(input, arc.aliases);
    if (score >= 1) {
      upsert(`arc-${arc.id}`, {
        episodeNumber: arc.episodeTo,
        label: `${arc.title}（第${arc.episodeTo}話まで）`,
        matchedVia: "arc",
        score,
      });
    }
  }

  // Episode-level: a direct title mention, e.g. "「最終試験」の回まで".
  for (const episode of getAllEpisodes(workId)) {
    if (!episode.title) continue;
    if (input.includes(episode.title)) {
      upsert(`episode-${episode.episodeNumber}`, {
        episodeNumber: episode.episodeNumber,
        label: `第${episode.episodeNumber}話（${episode.title}）`,
        matchedVia: "episode",
        score: 1,
      });
    }
  }

  const ranked = Array.from(candidates.values()).sort((a, b) => {
    const priorityDiff = KIND_PRIORITY[b.matchedVia] - KIND_PRIORITY[a.matchedVia];
    if (priorityDiff !== 0) return priorityDiff;
    return b.score - a.score;
  });

  const top = ranked.slice(0, MAX_CANDIDATES);
  return { candidates: top, bestGuess: top[0] ?? null };
}
