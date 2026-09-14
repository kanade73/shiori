import type { CanonFact, FabricatedFact, GenerationResult, NewFactDraft, ResponseEvaluation } from "../types";

/**
 * Heuristic checker instead of a second LLM call - docs/specs/mvp-spec.md section 8 Step 5
 * explicitly allows "別のLLM呼び出し【または】検査処理" (an LLM call OR a
 * deterministic check). This keeps the pipeline fast/cheap and avoids
 * relying on another model call to judge the first one.
 */

function norm(s: string): string {
  return s.toLowerCase().trim();
}

function directlyContradicts(
  a: { subject: string; relation: string; object: string },
  b: { subject: string; relation: string; object: string },
): boolean {
  return norm(a.subject) === norm(b.subject) && norm(a.relation) === norm(b.relation) && norm(a.object) !== norm(b.object);
}

export function evaluateGeneration(params: {
  result: GenerationResult;
  visibleCanonFacts: CanonFact[];
  allCanonFacts: CanonFact[];
  currentEpisode: number;
  existingFabricatedFacts: FabricatedFact[];
}): ResponseEvaluation {
  const { result, visibleCanonFacts, allCanonFacts, currentEpisode, existingFabricatedFacts } = params;

  let canonConflicts = 0;
  let fabricatedConflicts = 0;
  let spoilerRiskScore = result.spoilerRisk;

  const checkAgainstFuture = (draft: NewFactDraft) => {
    for (const id of draft.sourceCanonFactIds) {
      const fact = allCanonFacts.find((f) => f.id === id);
      if (fact && fact.episodeFrom > currentEpisode) {
        spoilerRiskScore = 1;
      }
    }
  };

  for (const draft of result.newFacts) {
    checkAgainstFuture(draft);
    if (visibleCanonFacts.some((fact) => directlyContradicts(draft, fact))) canonConflicts += 1;
    if (existingFabricatedFacts.some((fact) => directlyContradicts(draft, fact))) fabricatedConflicts += 1;
  }

  const believabilityScore = 0.85;
  const totalNew = Math.max(result.newFacts.length, 1);
  const canonContradictionScore = Math.min(1, canonConflicts / totalNew);
  const fabricatedConsistencyScore = 1 - Math.min(1, fabricatedConflicts / totalNew);

  const shouldRegenerate =
    spoilerRiskScore > 0.2 || fabricatedConsistencyScore < 0.7 || believabilityScore < 0.6 || canonContradictionScore > 0.3;

  const reasons: string[] = [];
  if (spoilerRiskScore > 0.2) reasons.push("視聴済み範囲を超えるネタバレの可能性がある");
  if (fabricatedConsistencyScore < 0.7) reasons.push("既存の嘘と矛盾している");
  if (canonContradictionScore > 0.3) reasons.push("本物の設定と矛盾している");

  return {
    canonContradictionScore,
    fabricatedConsistencyScore,
    spoilerRiskScore,
    believabilityScore,
    shouldRegenerate,
    reason: reasons.length > 0 ? reasons.join("、") : undefined,
  };
}
