import { contradictionReason, findContradictions, isClaimRelation, isFabricated, normalizeTriple, type Normalizer, type Triple } from "../claims";
import type { CanonFact, FabricatedFact, GenerationResult, ResponseEvaluation } from "../types";

/**
 * Deterministic checker. The generation step is deliberately unconstrained
 * (wild lies are the point) and is not even shown every lie it told; this is
 * the only place that says no, checking against *all* stored lies, and it
 * says no for exactly two reasons:
 *   1. a claim contradicts a lie the character already told this session
 *   2. a fabricated claim directly overwrites a visible canon fact
 * Both use the same rules (claims.ts): a lie may add details next to canon
 * ("モモンガ did A" and "モモンガ did B" coexist); it may not give a
 * one-valued relation a different value, negate canon, or flip likes/can.
 */

/**
 * 本物の設定を claims と同じ三つ組にする。話題の事実（topic-*）は claims と同じ閉じた語彙で書かれて
 * いるので照合できる。work.json の canonFacts は関係が自由記述（「持っている」など）なので照合しない。
 */
function canonTriple(fact: CanonFact, normalize: Normalizer): Triple | null {
  if (!isClaimRelation(fact.relation)) return null;
  return { subject: normalize(fact.subject), relation: fact.relation, object: normalize(fact.object), negated: false };
}

export function evaluateGeneration(params: {
  result: GenerationResult;
  visibleCanonFacts: CanonFact[];
  existingFabricatedFacts: FabricatedFact[];
  normalize: Normalizer;
}): ResponseEvaluation {
  const { result, visibleCanonFacts, existingFabricatedFacts, normalize } = params;

  const canon = visibleCanonFacts.flatMap((fact) => {
    const triple = canonTriple(fact, normalize);
    return triple ? [{ fact, triple }] : [];
  });

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

    if (!isFabricated(claim)) continue;
    for (const { fact, triple } of canon) {
      const reason = contradictionReason(normalized, triple);
      if (reason) {
        canonConflicts += 1;
        details.push(`「${claim.claim}」は本物の設定「${fact.description}」と矛盾する（${reason}）`);
        break;
      }
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
