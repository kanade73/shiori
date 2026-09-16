import { analyzeUserMessage } from "./analyze";
import { generateReply } from "./generate";
import { extractClaims } from "./extract";
import { countUserMessages, decideDirective, decideSessionPhase, isSceneKnown, toshioCooldownTurns } from "./directive";
import { evaluateGeneration } from "./evaluate";
import { generateToshioCommentary } from "./toshio";
import { decideExpression } from "./expression";
import { getActiveFabricatedFacts, retrieveCanonFacts, retrieveFabricatedFacts } from "../retrieval";
import { episodeBoundaryFor, isSameTopic, lookupSessionTopic } from "../topic";
import { detectTopicShift } from "../topic-shift";
import { getCanonFactsUpTo, getEntities } from "../works";
import { getCreatorProfiles } from "../creator";
import { buildNormalizer, findDuplicate, isFabricated, normalizeTriple } from "../claims";
import { createTurnEmitter, type TraceClaim } from "../events";
import type {
  Claim,
  GenerationResult,
  Message,
  ResponseEvaluation,
  SessionPhase,
  SessionTopic,
  ShioriExpression,
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
  /** この返答で見せるシオリの表情（directive とユーザーの聞き方から決める。嘘の有無には連動しない） */
  expression: ShioriExpression;
  regenerated: boolean;
  /** Fabricated claims from the final reply, normalized, that are not already stored. */
  newFabricatedClaims: Claim[];
  /** Stored lies the final reply restated (by normalized triple) or explicitly reused. */
  reusedFabricatedFactIds: string[];
  /** この発話で新しく把握した話題の場面（最初の話題、または切り替わった先）。変わらなければ null */
  newTopic: SessionTopic | null;
  /** この発話で話題が切り替わったなら、切り替わる前の話題 */
  previousTopic: SessionTopic | null;
  /** 話題の場面を踏まえたネタバレ境界。セッションに保存し、としおにも同じ値を渡す */
  currentEpisode: number;
  /** この発話分のイベントをまとめる id（開発者モードのパネル用）。 */
  turnId: string;
};

/** パネルに出す分だけに削った claim。 */
function toTraceClaim(c: Claim): TraceClaim {
  return { subject: c.subject, relation: c.relation, object: c.object, negated: c.negated, claim: c.claim, grounding: c.grounding };
}

// としおは毎回喋ると五月蝿いので、直近何ターンかは連続して割り込ませない。
// 頻度はコードが決める（としお本人の shouldComment は材料の有無で true に倒れやすく、頻度の調整には使えない）。
// ユーザーが考察・理由を求めた／疑ったときは短い間隔で乗り、シオリが嘘をついただけの回はもっと間を空ける。
export const TOSHIO_COOLDOWN_ON_QUESTION = 2;
export const TOSHIO_COOLDOWN_ON_CLAIMS = 5;

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

/**
 * 割り込みを検討する価値がある発話か（材料が薄いなら Gemini を呼ぶまでもない）。
 * ユーザーが考察・理由を求めている／疑っている回は主な出番なので短い間隔で通し、
 * シオリが嘘をついただけの回は長い間隔でしか通さない。
 */
export function worthAskingToshio(
  generation: GenerationResult,
  analysis: UserMessageAnalysis,
  turnsSince: number = Infinity,
  phase: SessionPhase = "early",
): boolean {
  // としおは evaluate を通らない。シオリが分からないふりで主張を避けた話題
  // （差し戻し2回後の定型文もここに落ちる）に、検査の無い経路で乗せない。
  if (generation.strategy === "admit_uncertainty") return false;
  // 終盤はクールダウンそのものを外す（directive.ts の TOSHIO_COOLDOWN_TURNS が 0）。
  // 嘘の密度と同じで、上げるのは頻度だけ。何を語るかには触れない。
  const scale = toshioCooldownTurns(phase) === 0 ? 0 : 1;
  const asked = analysis.questionType === "theory" || analysis.questionType === "doubt" || analysis.questionType === "fact_question";
  if (asked) return turnsSince >= TOSHIO_COOLDOWN_ON_QUESTION * scale;
  if (generation.claims.length > 0) return turnsSince >= TOSHIO_COOLDOWN_ON_CLAIMS * scale;
  return false;
}

/**
 * 話題が途中で切り替わったら、切り替わる前の履歴はシオリに渡さない（前の場面の話に引っ張られない
 * ようにし、文脈も小さく保つ）。前の話題で語った嘘は FabricatedFact として別に渡るので、
 * 履歴を落としても矛盾は検査できる。最初の話題（since なし）では何も落とさない。
 */
export function historyForTopic(history: Message[], topic: SessionTopic | null): Message[] {
  if (!topic?.since) return history;
  return history.filter((m) => m.createdAt >= topic.since!);
}

const FALLBACK_MESSAGE = "ちょっと分からなくなった。もう一度言って。";
const SAFE_UNCERTAIN_MESSAGE = "そこはうまく思い出せない。別のところの話、聞かせて。";

/**
 * (topic lookup until the session has one, topic-shift check after) ->
 * analyze (local) -> retrieve -> decide phase / directive (local) -> generate
 * (返答文だけ) -> extract (主張の取り出し) -> evaluate -> flagged なら feedback
 * 付きで generate → extract → evaluate をもう一度。API 呼び出しは1発話あたり
 * generate 1回 + extract 1回（差し戻し時は各2回）。
 *
 * 量と頻度はコードが決め、中身は LLM が決める。生成が見るのは関係する数件の嘘
 * だけで、整合は evaluate が視聴済み全件と照合して担保する。
 */
export async function runConversationPipeline(params: {
  workId: string;
  workTitle: string;
  sessionId: string;
  currentEpisode: number;
  /** セッションで既に把握している話題の場面。無ければこの発話から調べる（issue #14） */
  topic?: SessionTopic | null;
  /** 切り替わる前の話題（古い順） */
  pastTopics?: SessionTopic[];
  /** 今回の発話より前の履歴（切り替えがあれば、ここから切り替え後の分だけをシオリに渡す） */
  history: Message[];
  userMessage: string;
  /** 今回の発話を含むユーザー発話数。history は打ち切られているので呼び出し側が実数を渡す */
  userMessageCount?: number;
  /** 今回のユーザー発話を保存した時刻。話題が切り替わったら、これより前の履歴を落とす */
  userMessageAt?: string;
  /** 開発者モードのパネルで1発話分のイベントをまとめる id。省略すればここで発番する */
  turnId?: string;
}): Promise<PipelineResult> {
  const { workId, workTitle, sessionId, history, userMessage } = params;
  const pastTopics = params.pastTopics ?? [];

  // 話題が決まるまでは発話のたびに外部の知識源で調べる。決まった後は、話題が切り替わったと
  // 判定したとき（ゲート → 判定役）だけ、判定役が組み直した検索語で引き直す
  let topic = params.topic ?? null;
  let newTopic: SessionTopic | null = null;
  let previousTopic: SessionTopic | null = null;
  if (!topic) {
    newTopic = await lookupSessionTopic({ workId, workTitle, userMessage, ordinal: pastTopics.length + 1 });
    topic = newTopic;
  } else {
    const shift = await detectTopicShift({ workId, workTitle, topic, history, userMessage });
    if (shift) {
      const found = await lookupSessionTopic({
        workId,
        workTitle,
        userMessage,
        query: shift.query,
        ordinal: pastTopics.length + 2,
      });
      if (found && !isSameTopic(found, topic)) {
        previousTopic = topic;
        newTopic = { ...found, since: params.userMessageAt ?? new Date().toISOString() };
        topic = newTopic;
      }
    }
  }
  const topicsBefore = previousTopic ? [...pastTopics, previousTopic] : pastTopics;
  const currentEpisode = Math.max(params.currentEpisode, episodeBoundaryFor(workId, topic));
  const topicFacts = topic?.facts ?? [];

  // 開発者モードのパネルへの中継。購読者が居なければ何もしない。
  const turnId = params.turnId ?? crypto.randomUUID();
  const emit = createTurnEmitter(sessionId, turnId);
  emit({ stage: "user", text: userMessage });

  const analysis = analyzeUserMessage({ workId, currentEpisode, userMessage });
  emit({
    stage: "analyze",
    mentionedCharacters: analysis.mentionedCharacters,
    mentionedEvents: analysis.mentionedEvents,
    questionType: analysis.questionType,
  });
  // 生成には関係する数件、照合と検査には視聴済み全件（話題の場面について資料で
  // 確かめた設定も本物として数える）。守りは evaluate に寄せる。
  const promptCanonFacts = retrieveCanonFacts(workId, currentEpisode, analysis, topicFacts);
  const watchedCanonFacts = [...topicFacts, ...getCanonFactsUpTo(workId, currentEpisode)];
  const promptFabricatedFacts = await retrieveFabricatedFacts(sessionId, analysis);
  const existingFabricatedFacts = await getActiveFabricatedFacts(sessionId);
  const normalize = buildNormalizer(getEntities(workId));

  const phase = decideSessionPhase({
    fabricatedFactCount: existingFabricatedFacts.length,
    userMessageCount: params.userMessageCount ?? countUserMessages(history) + 1,
  });

  const directive = decideDirective({
    analysis,
    history,
    userMessage,
    fabricatedFacts: existingFabricatedFacts,
    relevantFacts: promptFabricatedFacts,
    phase,
    sceneKnown: isSceneKnown(topic, currentEpisode),
  });
  emit({
    stage: "directive",
    kind: directive.kind,
    phase,
    doubted: directive.kind === "layer" ? directive.doubted.map((f) => f.claim) : [],
    detailCount: directive.kind === "layer" ? directive.detailCount : undefined,
  });

  const genArgs = {
    workTitle,
    currentEpisode,
    topic,
    pastTopics: topicsBefore,
    canonFacts: promptCanonFacts,
    fabricatedFacts: promptFabricatedFacts,
    directive,
    history: historyForTopic(history, topic),
    userMessage,
  };

  // 取り出しに失敗しても返答文は返す（嘘が保存されないだけ）。会話が止まる方が損。
  // 推論サーバや Gemini が使えなければ extractClaims 自身が warn + claims 空で返し、
  // ここの catch はそれ以外の想定外の失敗を拾う。
  let attempt = 0;
  const extract = async (message: string): Promise<Claim[]> => {
    try {
      const { claims, backend, failed } = await extractClaims({
        text: message,
        workTitle,
        canonFacts: watchedCanonFacts,
        normalize,
        userMessage,
      });
      emit({ stage: "extract", attempt, claims: claims.map(toTraceClaim), backend, failed });
      return claims;
    } catch (error) {
      console.error("主張の取り出しに失敗:", error);
      emit({ stage: "extract", attempt, claims: [], failed: true });
      return [];
    }
  };

  const respond = async (feedback?: string): Promise<GenerationResult> => {
    attempt += 1;
    const message = await generateReply({ ...genArgs, feedback });
    emit({ stage: "generate", attempt, message });
    return { message, claims: await extract(message), strategy: "no_new_lie" };
  };

  const evaluate = (claims: Claim[]) => {
    const result = evaluateGeneration({
      claims,
      visibleCanonFacts: watchedCanonFacts,
      existingFabricatedFacts,
      normalize,
    });
    emit({ stage: "evaluate", attempt, flagged: result.shouldRegenerate, reason: result.reason, details: result.details });
    return result;
  };

  let generation = await respond();
  let evaluation = evaluate(generation.claims);

  let regenerated = false;
  let gaveUp = false;
  if (evaluation.shouldRegenerate) {
    regenerated = true;
    const feedback = [evaluation.reason, ...evaluation.details.map((d) => `- ${d}`)].filter(Boolean).join("\n");
    emit({ stage: "regenerate", reason: feedback });
    generation = await respond(feedback);
    evaluation = evaluate(generation.claims);

    // Still flagged after one retry: don't trust the generated *text* either
    // (it may have been written around the very lie we're discarding), so
    // replace the whole reply with a safe non-answer rather than looping.
    if (evaluation.shouldRegenerate) {
      gaveUp = true;
      emit({ stage: "fallback" });
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
    expression: decideExpression({ directive, analysis, generation }),
    regenerated,
    newFabricatedClaims,
    reusedFabricatedFactIds: Array.from(reused),
    newTopic,
    previousTopic,
    currentEpisode,
    turnId,
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
  /** シオリのパイプラインが返した境界（話題の場面を踏まえたもの） */
  currentEpisode: number;
  /** セッションの話題の場面（この発話で決まったものも含む） */
  topic?: SessionTopic | null;
  /** シオリのパイプラインに渡したのと同じ、今回の発話より前の履歴 */
  history: Message[];
  userMessage: string;
  analysis: UserMessageAnalysis;
  generation: GenerationResult;
  /** 終盤はクールダウンを外して毎ターン割り込めるようにする */
  phase: SessionPhase;
  /** シオリと同じターンとしてパネルに並べるための id */
  turnId?: string;
}): Promise<string | null> {
  const { workId, workTitle, sessionId, currentEpisode, topic, history, userMessage, analysis, generation, phase } = params;
  const emit = createTurnEmitter(sessionId, params.turnId ?? crypto.randomUUID());

  // どの場面か分からないうちは、シオリは場面を聞き返している。としおは evaluate を通らないので、
  // 本物の設定が1件も無いまま場面の考察を語らせない（issue #32）
  if (!isSceneKnown(topic, currentEpisode)) {
    emit({ stage: "toshio", interjected: false, skipped: "material" });
    return null;
  }
  const turnsSince = turnsSinceLastToshio(history);
  if (turnsSince < toshioCooldownTurns(phase)) {
    emit({ stage: "toshio", interjected: false, skipped: "cooldown" });
    return null;
  }
  if (!worthAskingToshio(generation, analysis, turnsSince, phase)) {
    emit({ stage: "toshio", interjected: false, skipped: "material" });
    return null;
  }

  try {
    // 作風は取れなくても割り込みは成立する（作り手の記事が無い作品もある）
    const creators = await getCreatorProfiles(workId).catch(() => []);
    const commentary = await generateToshioCommentary({
      creators,
      workTitle,
      currentEpisode,
      topic: topic ?? null,
      canonFacts: retrieveCanonFacts(workId, currentEpisode, analysis, topic?.facts ?? []),
      fabricatedFacts: await retrieveFabricatedFacts(sessionId, analysis),
      userMessage,
      shioriMessage: generation.message,
      premises: generation.claims.filter(isFabricated),
    });
    if (commentary.shouldComment && commentary.message.trim().length > 0) {
      emit({ stage: "toshio", interjected: true });
      return commentary.message;
    }
    emit({ stage: "toshio", interjected: false, skipped: "declined" });
    return null;
  } catch (error) {
    // としおの割り込みは演出であって本筋ではない。失敗してもシオリの返答は
    // 既に確定しているので、単に今回は割り込まなかったことにする。
    console.error("としおの割り込み生成に失敗:", error);
    emit({ stage: "toshio", interjected: false, skipped: "failed" });
    return null;
  }
}

export function fallbackMessage(): string {
  return FALLBACK_MESSAGE;
}
