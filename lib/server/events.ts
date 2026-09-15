import { EventEmitter } from "node:events";
import type { PhaseLimits } from "./llm/directive";
import type { RevealGraph } from "./reveal/types";
import type { ClaimGrounding, ClaimRelation, QuestionType, ResponseStrategy, SessionPhase } from "./types";

/**
 * 開発者モードのパネル（チャットの右側）に、パイプラインの各段の結果をそのまま
 * 流すための in-process なイベントバス。単一プロセス・単一ユーザー前提なので、
 * DB もポーリングも挟まずセッション ID ごとの EventEmitter で足りる。
 *
 * 会話の SSE（messages の Route Handler）には載せない。購読者が居なければ emit は
 * ただの no-op で、パイプラインの結果は何も変わらない。
 */

/** extract が取り出した主張1件を、パネルに出す分だけに削ったもの。 */
export type TraceClaim = {
  subject: string;
  relation: ClaimRelation;
  object: string;
  negated: boolean;
  claim: string;
  grounding: ClaimGrounding;
};

/** パネルが読む「1つの段が終わった」という知らせ。turnId が同じものが1発話分。 */
export type PipelineEvent = { turnId: string; at: string } & (
  | { stage: "user"; text: string }
  | { stage: "analyze"; mentionedCharacters: string[]; mentionedEvents: string[]; questionType: QuestionType }
  | { stage: "directive"; kind: "introduce" | "layer" | "plain"; phase: SessionPhase; doubted: string[]; detailCount?: number }
  | { stage: "generate"; attempt: number; message: string }
  | { stage: "extract"; attempt: number; claims: TraceClaim[]; failed?: boolean }
  | { stage: "evaluate"; attempt: number; flagged: boolean; reason?: string; details: string[] }
  | { stage: "regenerate"; reason: string }
  | { stage: "fallback" }
  | { stage: "toshio"; interjected: boolean; skipped?: "cooldown" | "material" | "declined" | "failed" }
  | { stage: "saved"; newFactIds: string[]; strategy: ResponseStrategy; phase: SessionPhase }
);

/** turnId と時刻を除いた各段のイベント（union を保ったまま Omit する）。 */
export type PipelineStageEvent = PipelineEvent extends infer T
  ? T extends PipelineEvent
    ? Omit<T, "turnId" | "at">
    : never
  : never;

export type PipelineEventListener = (event: PipelineEvent) => void;

/** 接続した時点のセッションの状態（events の SSE が init として送る）。 */
export type DevEventsInit = {
  phase: SessionPhase;
  limits: PhaseLimits;
  fabricatedFactCount: number;
  userMessageCount: number;
  graph: RevealGraph;
};

/** 嘘が保存されたあとの描き直し（events の SSE が graph として送る）。 */
export type DevEventsGraph = {
  graph: RevealGraph;
  /** 今回増えた嘘。パネルはこれを軽く強調する */
  newFactIds: string[];
  phase: SessionPhase;
  limits: PhaseLimits;
  fabricatedFactCount: number;
};

// dev サーバーのホットリロードでこのモジュールが読み直されても、既に張られた購読が
// 切れないように globalThis に1本だけ持つ。
const globalForBus = globalThis as unknown as { __pipelineEventBus?: EventEmitter };
const bus = (globalForBus.__pipelineEventBus ??= new EventEmitter());
// タブを何枚開いても警告を出さない（購読は1タブ1本）
bus.setMaxListeners(0);

export function emitPipelineEvent(sessionId: string, event: PipelineEvent): void {
  bus.emit(sessionId, event);
}

/** 購読する。戻り値を呼ぶと解除（SSE の cancel で必ず呼ぶこと）。 */
export function subscribePipelineEvents(sessionId: string, listener: PipelineEventListener): () => void {
  bus.on(sessionId, listener);
  return () => {
    bus.off(sessionId, listener);
  };
}

export function pipelineEventListenerCount(sessionId: string): number {
  return bus.listenerCount(sessionId);
}

/**
 * 1発話分の emit をまとめる小さなヘルパー。turnId と時刻を埋めるだけで、
 * 何を送るかは呼ぶ側が決める。
 */
export function createTurnEmitter(sessionId: string, turnId: string) {
  return (event: PipelineStageEvent) => {
    emitPipelineEvent(sessionId, { ...event, turnId, at: new Date().toISOString() } as PipelineEvent);
  };
}
