import { analyzeUserMessage } from "./analyze";
import { generateResponse } from "./generate";
import { evaluateGeneration } from "./evaluate";
import { generateToshioCommentary } from "./toshio";
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

// としおは毎回喋ると五月蝿いので、直近何ターンかは連続して割り込ませない
// （「まとまる」の定義はissue #6で実装者判断としている単純なクールダウン方式）。
const TOSHIO_COOLDOWN_TURNS = 2;

/** 直近のとしお発話から何ターン（シオリの返答）経ったか。一度も話していなければ Infinity。 */
export function turnsSinceLastToshio(history: Message[]): number {
  let turns = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    const m = history[i];
    if (m.role !== "assistant") continue;
    if (m.speaker === "toshio") return turns;
    turns += 1;
  }
  return Infinity;
}

/** 割り込みを検討する価値がある発話か（材料が薄いなら Gemini を呼ぶまでもない）。 */
export function worthAskingToshio(generation: GenerationResult, analysis: UserMessageAnalysis): boolean {
  // としおは evaluate を通らない。シオリがネタバレ域と判断して逸らした話題や、
  // 分からないふりで主張を避けた話題（差し戻し2回後の定型文もここに落ちる）に
  // 検査の無い経路で乗せない。
  if (generation.strategy === "avoid_spoiler" || generation.strategy === "admit_uncertainty") return false;
  if (generation.claims.length > 0) return true;
  return analysis.questionType === "theory" || analysis.questionType === "doubt" || analysis.questionType === "fact_question";
}

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

/**
 * issue #6: としおの割り込み。シオリの返答を流し終えて保存した後に呼ぶ
 * （シオリのパイプラインに含めると、としお分の Gemini 待ちがシオリの返答の
 * 表示まで遅らせる）。材料はシオリと同じ取り方で取り直すので、この発話で
 * シオリが新しくついた嘘も「既に語った設定」として渡る。
 * 割り込むなら本文、しないなら null。失敗しても例外にしない。
 */
export async function runToshioInterjection(params: {
  workId: string;
  workTitle: string;
  sessionId: string;
  currentEpisode: number;
  /** シオリのパイプラインに渡したのと同じ、今回の発話より前の履歴 */
  history: Message[];
  userMessage: string;
  analysis: UserMessageAnalysis;
  generation: GenerationResult;
}): Promise<string | null> {
  const { workId, workTitle, sessionId, currentEpisode, history, userMessage, analysis, generation } = params;

  if (turnsSinceLastToshio(history) < TOSHIO_COOLDOWN_TURNS) return null;
  if (!worthAskingToshio(generation, analysis)) return null;

  try {
    const commentary = await generateToshioCommentary({
      workTitle,
      currentEpisode,
      canonFacts: retrieveCanonFacts(workId, currentEpisode, analysis),
      fabricatedFacts: retrieveFabricatedFacts(sessionId, analysis),
      userMessage,
      shioriMessage: generation.message,
    });
    if (commentary.shouldComment && commentary.message.trim().length > 0) return commentary.message;
    return null;
  } catch (error) {
    // としおの割り込みは演出であって本筋ではない。失敗してもシオリの返答は
    // 既に確定しているので、単に今回は割り込まなかったことにする。
    console.error("としおの割り込み生成に失敗:", error);
    return null;
  }
}

export function fallbackMessage(): string {
  return FALLBACK_MESSAGE;
}
