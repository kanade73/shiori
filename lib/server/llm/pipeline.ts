import { analyzeUserMessage } from "./analyze";
import { generateResponse } from "./generate";
import { evaluateGeneration } from "./evaluate";
import { retrieveCanonFacts, retrieveFabricatedFacts } from "../retrieval";
import { getAllCanonFacts } from "../works";
import type { GenerationResult, Message, ResponseEvaluation } from "../types";

export type PipelineResult = {
  generation: GenerationResult;
  evaluation: ResponseEvaluation;
  regenerated: boolean;
};

const FALLBACK_MESSAGE = "……ちょっと分からなくなった。もう一度言って。";
const SAFE_UNCERTAIN_MESSAGE = "……そこはちょっとうまく思い出せない。別のところの話、聞かせて。";

/**
 * Runs docs/specs/mvp-spec.md section 4 "会話時" steps 3-9: analyze -> retrieve -> decide
 * strategy & generate -> evaluate -> regenerate once if flagged.
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

  const analysis = await analyzeUserMessage(userMessage);
  const visibleCanonFacts = retrieveCanonFacts(workId, currentEpisode, analysis);
  const existingFabricatedFacts = retrieveFabricatedFacts(sessionId);
  const allCanonFacts = getAllCanonFacts(workId);

  const genArgs = {
    workTitle,
    currentEpisode,
    canonFacts: visibleCanonFacts,
    fabricatedFacts: existingFabricatedFacts,
    history,
    userMessage,
  };

  let generation = await generateResponse(genArgs);
  let evaluation = evaluateGeneration({
    result: generation,
    visibleCanonFacts,
    allCanonFacts,
    currentEpisode,
    existingFabricatedFacts,
  });

  let regenerated = false;
  if (evaluation.shouldRegenerate) {
    regenerated = true;
    generation = await generateResponse({ ...genArgs, feedback: evaluation.reason });
    evaluation = evaluateGeneration({
      result: generation,
      visibleCanonFacts,
      allCanonFacts,
      currentEpisode,
      existingFabricatedFacts,
    });

    // Still flagged after one retry: don't trust the generated *text* either
    // (it may have been written around the very lie we're discarding, so
    // clearing newFacts alone could still leave spoiler-risk prose on
    // screen) - replace the whole reply with a safe, generic non-answer
    // per docs/specs/mvp-spec.md section 13 rather than looping.
    if (evaluation.shouldRegenerate) {
      generation = {
        ...generation,
        message: SAFE_UNCERTAIN_MESSAGE,
        newFacts: [],
        usedExistingFactIds: [],
        strategy: "admit_uncertainty",
        spoilerRisk: 0,
      };
    }
  }

  return { generation, evaluation, regenerated };
}

export function fallbackMessage(): string {
  return FALLBACK_MESSAGE;
}
