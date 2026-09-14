import { analyzeUserMessage } from "./analyze";
import { generateResponse } from "./generate";
import { evaluateGeneration } from "./evaluate";
import { retrieveCanonFacts, retrieveFabricatedFacts } from "../retrieval";
import { getAllCanonFacts, getEntities } from "../works";
import { buildNormalizer, findDuplicate, isFabricated, normalizeTriple } from "../claims";
import type { Claim, GenerationResult, Message, ResponseEvaluation, UserMessageAnalysis } from "../types";

export type PipelineResult = {
  analysis: UserMessageAnalysis;
  generation: GenerationResult;
  evaluation: ResponseEvaluation;
  regenerated: boolean;
  /** Fabricated claims from the final reply, normalized, that are not already stored. */
  newFabricatedClaims: Claim[];
  /** Stored lies the final reply restated (by normalized triple) or explicitly reused. */
  reusedFabricatedFactIds: string[];
};

const FALLBACK_MESSAGE = "……ちょっと分からなくなった。もう一度言って。";
const SAFE_UNCERTAIN_MESSAGE = "……そこはちょっとうまく思い出せない。別のところの話、聞かせて。";

/**
 * analyze (local) -> retrieve -> generate -> evaluate -> regenerate once if
 * flagged. Generation is unconstrained; consistency is enforced only after
 * the fact, against what the character already said in this session.
 */
export async function runConversationPipeline(params: {
  workId: string;
  workTitle: string;
  sessionId: string;
  currentEpisode: number;
  history: Message[];
  userMessage: string;
}): Promise<PipelineResult> {
  const { workId, workTitle, sessionId, currentEpisode, history, userMessage } = params;

  const analysis = analyzeUserMessage({ workId, currentEpisode, userMessage });
  const visibleCanonFacts = retrieveCanonFacts(workId, currentEpisode, analysis);
  const existingFabricatedFacts = retrieveFabricatedFacts(sessionId, analysis);
  const allCanonFacts = getAllCanonFacts(workId);
  const normalize = buildNormalizer(getEntities(workId));

  const genArgs = {
    workTitle,
    currentEpisode,
    canonFacts: visibleCanonFacts,
    fabricatedFacts: existingFabricatedFacts,
    history,
    userMessage,
  };
  const evaluate = (result: GenerationResult) =>
    evaluateGeneration({
      result,
      visibleCanonFacts,
      allCanonFacts,
      currentEpisode,
      existingFabricatedFacts,
      normalize,
    });

  let generation = await generateResponse(genArgs);
  let evaluation = evaluate(generation);

  let regenerated = false;
  if (evaluation.shouldRegenerate) {
    regenerated = true;
    const feedback = [evaluation.reason, ...evaluation.details.map((d) => `- ${d}`)].filter(Boolean).join("\n");
    generation = await generateResponse({ ...genArgs, feedback });
    evaluation = evaluate(generation);

    // Still flagged after one retry: don't trust the generated *text* either
    // (it may have been written around the very lie we're discarding), so
    // replace the whole reply with a safe non-answer rather than looping.
    if (evaluation.shouldRegenerate) {
      generation = {
        ...generation,
        message: SAFE_UNCERTAIN_MESSAGE,
        claims: [],
        usedExistingFactIds: [],
        strategy: "admit_uncertainty",
        spoilerRisk: 0,
      };
    }
  }

  const newFabricatedClaims: Claim[] = [];
  const reused = new Set<string>(generation.usedExistingFactIds);
  for (const claim of generation.claims) {
    if (!isFabricated(claim)) continue;
    const normalized = normalizeTriple(claim, normalize);
    const duplicate = findDuplicate(normalized, existingFabricatedFacts);
    if (duplicate) {
      reused.add(duplicate.id);
    } else if (!newFabricatedClaims.some((c) => c.subject === normalized.subject && c.relation === normalized.relation && c.object === normalized.object && c.negated === normalized.negated)) {
      newFabricatedClaims.push(normalized);
    }
  }

  return {
    analysis,
    generation,
    evaluation,
    regenerated,
    newFabricatedClaims,
    reusedFabricatedFactIds: Array.from(reused),
  };
}

export function fallbackMessage(): string {
  return FALLBACK_MESSAGE;
}
