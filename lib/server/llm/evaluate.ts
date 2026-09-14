import { findContradictions, isFabricated, normalizeTriple, type Normalizer } from "../claims";
import type { CanonFact, Claim, FabricatedFact, GenerationResult, ResponseEvaluation } from "../types";

/**
 * Deterministic checker. The generation step is deliberately unconstrained
 * (wild lies are the point) and is not even shown every lie it told; this is
 * the only place that says no, checking against *all* stored lies, and it
 * says no for exactly two reasons:
 *   1. a claim contradicts a lie the character already told this session
 *   2. a fabricated claim directly overwrites a visible canon fact
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
  existingFabricatedFacts: FabricatedFact[];
  normalize: Normalizer;
}): ResponseEvaluation {
  const { result, visibleCanonFacts, existingFabricatedFacts, normalize } = params;

  const details: string[] = [];
  let canonConflicts = 0;
  let fabricatedConflicts = 0;

  for (const claim of result.claims) {
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

  const shouldRegenerate = fabricatedConflicts > 0 || canonContradictionScore > 0.3;

  const reasons: string[] = [];
  if (fabricatedConflicts > 0) reasons.push("既に語った設定と矛盾している");
  if (canonContradictionScore > 0.3) reasons.push("本物の設定と矛盾している");

  return {
    canonContradictionScore,
    fabricatedConsistencyScore,
    believabilityScore,
    shouldRegenerate,
    reason: reasons.length > 0 ? reasons.join("、") : undefined,
    details,
  };
}
