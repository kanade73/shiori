import { analyzeUserMessage } from "./analyze";
import { generateReply } from "./generate";
import { extractClaims } from "./extract";
import { countUserMessages, decideDirective, decideSessionPhase, toshioCooldownTurns } from "./directive";
import { evaluateGeneration } from "./evaluate";
import { generateToshioCommentary } from "./toshio";
import { getActiveFabricatedFacts, retrieveCanonFacts, retrieveFabricatedFacts } from "../retrieval";
import { getEntities } from "../works";
import { buildNormalizer, findDuplicate, isFabricated, normalizeTriple } from "../claims";
import type {
  Claim,
  GenerationResult,
  Message,
  ResponseEvaluation,
  SessionPhase,
  TurnDirective,
  UserMessageAnalysis,
} from "../types";

export type PipelineResult = {
  analysis: UserMessageAnalysis;
  generation: GenerationResult;
  evaluation: ResponseEvaluation;
  /** バックエンドがこのターンに決めた「今回の指示」。 */
  directive: TurnDirective;
  /** 嘘がどれだけ積み上がったか。UI がこれを読んで終盤を検出できる。 */
  phase: SessionPhase;
  regenerated: boolean;
  /** Fabricated claims from the final reply, normalized, that are not already stored. */
  newFabricatedClaims: Claim[];
  /** Stored lies the final reply restated (by normalized triple) or explicitly reused. */
  reusedFabricatedFactIds: string[];
};

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
  // としおは evaluate を通らない。シオリが分からないふりで主張を避けた話題
  // （差し戻し2回後の定型文もここに落ちる）に、検査の無い経路で乗せない。
  if (generation.strategy === "admit_uncertainty") return false;
  if (generation.claims.length > 0) return true;
  return analysis.questionType === "theory" || analysis.questionType === "doubt" || analysis.questionType === "fact_question";
}

const FALLBACK_MESSAGE = "……ちょっと分からなくなった。もう一度言って。";
const SAFE_UNCERTAIN_MESSAGE = "……そこはちょっとうまく思い出せない。別のところの話、聞かせて。";

/**
 * analyze (local) -> retrieve -> decide phase / directive (local) -> generate
 * (返答文だけ) -> extract (主張の取り出し) -> evaluate -> flagged なら feedback
 * 付きで generate → extract → evaluate をもう一度。API 呼び出しは1発話あたり
 * generate 1回 + extract 1回（差し戻し時は各2回）。
 *
 * 量と頻度はコードが決め、中身は LLM が決める。生成が見るのは関係する数件の嘘
 * だけで、整合は evaluate が全件と照合して担保する。
 */
export async function runConversationPipeline(params: {
  workId: string;
  workTitle: string;
  sessionId: string;
  currentEpisode: number;
  history: Message[];
  userMessage: string;
  /** 今回の発話を含むユーザー発話数。history は打ち切られているので呼び出し側が実数を渡す */
  userMessageCount?: number;
}): Promise<PipelineResult> {
  const { workId, workTitle, sessionId, currentEpisode, history, userMessage } = params;

  const analysis = analyzeUserMessage({ workId, currentEpisode, userMessage });
  const visibleCanonFacts = retrieveCanonFacts(workId, currentEpisode, analysis);
  // 生成には関係する数件、検査には全件。守りは evaluate に寄せる。
  const promptFabricatedFacts = retrieveFabricatedFacts(sessionId, analysis);
  const existingFabricatedFacts = getActiveFabricatedFacts(sessionId);
  const normalize = buildNormalizer(getEntities(workId));

  const phase = decideSessionPhase({
    fabricatedFactCount: existingFabricatedFacts.length,
    userMessageCount: params.userMessageCount ?? countUserMessages(history) + 1,
  });

  const directive = decideDirective({
    analysis,
    history,
    fabricatedFacts: existingFabricatedFacts,
    relevantFacts: promptFabricatedFacts,
    phase,
  });

  const genArgs = {
    workTitle,
    currentEpisode,
    canonFacts: visibleCanonFacts,
    fabricatedFacts: promptFabricatedFacts,
    directive,
    history,
    userMessage,
  };

  // 取り出しに失敗しても返答文は返す（嘘が保存されないだけ）。会話が止まる方が損。
  const extract = async (message: string): Promise<Claim[]> => {
    try {
      return await extractClaims({
        text: message,
        workTitle,
        canonFacts: visibleCanonFacts,
        normalize,
        userMessage,
      });
    } catch (error) {
      console.error("主張の取り出しに失敗:", error);
      return [];
    }
  };

  const respond = async (feedback?: string): Promise<GenerationResult> => {
    const message = await generateReply({ ...genArgs, feedback });
    return { message, claims: await extract(message), strategy: "no_new_lie" };
  };

  const evaluate = (claims: Claim[]) =>
    evaluateGeneration({
      claims,
      visibleCanonFacts,
      existingFabricatedFacts,
      normalize,
    });

  let generation = await respond();
  let evaluation = evaluate(generation.claims);

  let regenerated = false;
  let gaveUp = false;
  if (evaluation.shouldRegenerate) {
    regenerated = true;
    const feedback = [evaluation.reason, ...evaluation.details.map((d) => `- ${d}`)].filter(Boolean).join("\n");
    generation = await respond(feedback);
    evaluation = evaluate(generation.claims);

    // Still flagged after one retry: don't trust the generated *text* either
    // (it may have been written around the very lie we're discarding), so
    // replace the whole reply with a safe non-answer rather than looping.
    if (evaluation.shouldRegenerate) {
      gaveUp = true;
      generation = { message: SAFE_UNCERTAIN_MESSAGE, claims: [], strategy: "admit_uncertainty" };
    }
  }

  const newFabricatedClaims: Claim[] = [];
  const reused = new Set<string>();
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

  // strategy はモデルに選ばせない。何を保存したかから事後に決める（表示・ゲーティング用）。
  if (!gaveUp) {
    generation.strategy =
      newFabricatedClaims.length > 0 ? "introduce_small_lie" : reused.size > 0 ? "reinforce_existing_lie" : "no_new_lie";
  }

  return {
    analysis,
    generation,
    evaluation,
    directive,
    phase,
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
  /** 終盤はクールダウンを外して毎ターン割り込めるようにする */
  phase: SessionPhase;
}): Promise<string | null> {
  const { workId, workTitle, sessionId, currentEpisode, history, userMessage, analysis, generation, phase } = params;

  if (turnsSinceLastToshio(history) < toshioCooldownTurns(phase)) return null;
  if (!worthAskingToshio(generation, analysis)) return null;

  try {
    const commentary = await generateToshioCommentary({
      workTitle,
      currentEpisode,
      canonFacts: retrieveCanonFacts(workId, currentEpisode, analysis),
      fabricatedFacts: retrieveFabricatedFacts(sessionId, analysis),
      userMessage,
      shioriMessage: generation.message,
      premises: generation.claims.filter(isFabricated),
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
