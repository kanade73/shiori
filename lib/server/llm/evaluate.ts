import { CLAIM_RELATIONS, contradictionReason, findContradictions, isFabricated, normalizeText, normalizeTriple, type Normalizer, type Triple } from "../claims";
import type { CanonFact, FabricatedFact, GenerationResult, ResponseEvaluation } from "../types";

/**
 * Deterministic checker. The generation step is deliberately unconstrained
 * (wild lies are the point) and is not even shown every lie it told; this is
 * the only place that says no, checking against *all* stored lies, and it
 * says no for exactly two reasons:
 *   1. a claim contradicts a lie the character already told this session
 *   2. a fabricated claim directly overwrites a visible canon fact
 */

/** canonは肯定の三つ組。既存の嘘と同じ規則で、両立しない主張だけを検出する。 */
function canonContradictionReason(claim: Triple, canon: CanonFact, normalize: Normalizer): string | null {
  // work.jsonの自由記述relationは、閉じた語彙と一致するときだけ比較する。
  // 「住んでいる」などの自然言語を意味推定して判定することはしない。
  const relation = CLAIM_RELATIONS.find((r) => r === normalizeText(canon.relation));
  if (!relation) return null;
  return contradictionReason(claim, normalizeTriple({
    subject: canon.subject, relation, object: canon.object, negated: false,
  }, normalize));
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

    if (isFabricated(claim)) {
      let contradictsCanon = false;
      for (const fact of visibleCanonFacts) {
        const reason = canonContradictionReason(normalized, fact, normalize);
        if (!reason) continue;
        contradictsCanon = true;
        details.push(`「${claim.claim}」は本物の設定「${fact.description}」と矛盾する（${reason}）`);
      }
      // 根拠が複数あっても、矛盾したclaimは1件として数える。
      if (contradictsCanon) canonConflicts += 1;
    }
  }

  const believabilityScore = 0.85;
  const total = Math.max(result.claims.length, 1);
  const canonContradictionScore = Math.min(1, canonConflicts / total);
  const fabricatedConsistencyScore = fabricatedConflicts > 0 ? 0 : 1;

  const shouldRegenerate = fabricatedConflicts > 0 || canonConflicts > 0;

  const reasons: string[] = [];
  if (fabricatedConflicts > 0) reasons.push("既に語った設定と矛盾している");
  if (canonConflicts > 0) reasons.push("本物の設定と矛盾している");

  return {
    canonContradictionScore,
    fabricatedConsistencyScore,
    believabilityScore,
    shouldRegenerate,
    reason: reasons.length > 0 ? reasons.join("、") : undefined,
    details,
  };
}
