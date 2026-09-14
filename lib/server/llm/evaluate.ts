import { findContradictions, isFabricated, normalizeTriple, type Normalizer } from "../claims";
import type { CanonFact, Claim, FabricatedFact, GenerationResult, ResponseEvaluation } from "../types";

/**
 * Deterministic checker. The generation step is deliberately unconstrained
 * (wild lies are the point) and is not even shown every lie it told; this is
 * the only place that says no, checking against *all* stored lies, and it
 * says no for exactly three reasons:
 *   1. a claim contradicts a lie the character already told this session
 *   2. a claim cites a canon fact beyond the user's viewing progress
 *   3. a fabricated claim directly overwrites a visible canon fact
 */

function contradictsCanon(claim: Claim, canon: CanonFact, normalize: Normalizer): boolean {
  // Canon relations are free text, so only the coarse case is checkable:
  // same subject, same relation phrase, different object.
  return (
    normalize(claim.subject) === normalize(canon.subject) &&
    normalize(claim.relation) === normalize(canon.relation) &&
    normalize(claim.object) !== normalize(canon.object)
  );
}

export function evaluateGeneration(params: {
  result: GenerationResult;
  visibleCanonFacts: CanonFact[];
  allCanonFacts: CanonFact[];
  currentEpisode: number;
  existingFabricatedFacts: FabricatedFact[];
  normalize: Normalizer;
}): ResponseEvaluation {
  const { result, visibleCanonFacts, allCanonFacts, currentEpisode, existingFabricatedFacts, normalize } = params;

  const details: string[] = [];
  let canonConflicts = 0;
  let fabricatedConflicts = 0;
  let spoilerRiskScore = 0;

  for (const claim of result.claims) {
    for (const id of claim.sourceCanonFactIds) {
      const fact = allCanonFacts.find((f) => f.id === id);
      if (fact && fact.episodeFrom > currentEpisode) {
        spoilerRiskScore = 1;
        details.push(`「${claim.claim}」は第${fact.episodeFrom}話以降の情報（${fact.id}）に基づいている`);
      }
    }

    const normalized = normalizeTriple(claim, normalize);
    const contradictions = findContradictions(normalized, existingFabricatedFacts);
    if (contradictions.length > 0) {
      fabricatedConflicts += 1;
      for (const c of contradictions) {
        details.push(`「${claim.claim}」は既に語った「${c.existing.claim}」と矛盾する（${c.reason}）`);
      }
    }

    if (isFabricated(claim) && visibleCanonFacts.some((fact) => contradictsCanon(claim, fact, normalize))) {
      canonConflicts += 1;
      details.push(`「${claim.claim}」は本物の設定と直接矛盾する`);
    }
  }

  const believabilityScore = 0.85;
  const total = Math.max(result.claims.length, 1);
  const canonContradictionScore = Math.min(1, canonConflicts / total);
  const fabricatedConsistencyScore = fabricatedConflicts > 0 ? 0 : 1;

  const shouldRegenerate = spoilerRiskScore > 0.2 || fabricatedConflicts > 0 || canonContradictionScore > 0.3;

  const reasons: string[] = [];
  if (spoilerRiskScore > 0.2) reasons.push("視聴済み範囲を超えるネタバレの可能性がある");
  if (fabricatedConflicts > 0) reasons.push("既に語った設定と矛盾している");
  if (canonContradictionScore > 0.3) reasons.push("本物の設定と矛盾している");

  return {
    canonContradictionScore,
    fabricatedConsistencyScore,
    spoilerRiskScore,
    believabilityScore,
    shouldRegenerate,
    reason: reasons.length > 0 ? reasons.join("、") : undefined,
    details,
  };
}
