import type { PipelineEvent, TraceClaim } from "@/lib/server/events";

/**
 * パイプラインのイベントを、1発話ぶん（turnId ごと）にまとめ直す純粋関数。
 * 表示は components/devpanel/DevPanel.tsx。
 */

/** 生成1回ぶん。差し戻しがあれば2つ並ぶ */
export type TraceAttempt = {
  attempt: number;
  message?: string;
  claims?: TraceClaim[];
  /** 三つ組をどちらで取り出したか（gemini / local） */
  extractBackend?: string;
  extractFailed?: boolean;
  evaluation?: { flagged: boolean; reason?: string; details: string[] };
};

export type TraceTurn = {
  id: string;
  at: string;
  userText?: string;
  analyze?: { mentionedCharacters: string[]; mentionedEvents: string[]; questionType: string };
  directive?: { kind: "introduce" | "layer" | "plain"; phase: string; doubted: string[]; detailCount?: number };
  attempts: TraceAttempt[];
  regenerateReason?: string;
  fallback?: boolean;
  toshio?: { interjected: boolean; skipped?: "cooldown" | "material" | "declined" | "failed" };
  saved?: { newFactIds: string[]; strategy: string };
};

/** パネルに積んでおくターン数。これより古いものは落とす */
export const MAX_TURNS = 8;

function attemptOf(turn: TraceTurn, attempt: number): TraceAttempt {
  const found = turn.attempts.find((a) => a.attempt === attempt);
  if (found) return found;
  const created: TraceAttempt = { attempt };
  turn.attempts.push(created);
  return created;
}

/** イベントを1件取り込んだ新しいターン配列を返す（新しいものが末尾）。 */
export function reduceTurns(turns: TraceTurn[], event: PipelineEvent): TraceTurn[] {
  const next = turns.map((t) => ({ ...t, attempts: t.attempts.map((a) => ({ ...a })) }));
  let turn = next.find((t) => t.id === event.turnId);
  if (!turn) {
    turn = { id: event.turnId, at: event.at, attempts: [] };
    next.push(turn);
  }

  switch (event.stage) {
    case "user":
      turn.userText = event.text;
      break;
    case "analyze":
      turn.analyze = {
        mentionedCharacters: event.mentionedCharacters,
        mentionedEvents: event.mentionedEvents,
        questionType: event.questionType,
      };
      break;
    case "directive":
      turn.directive = { kind: event.kind, phase: event.phase, doubted: event.doubted, detailCount: event.detailCount };
      break;
    case "generate":
      attemptOf(turn, event.attempt).message = event.message;
      break;
    case "extract": {
      const a = attemptOf(turn, event.attempt);
      a.claims = event.claims;
      a.extractBackend = event.backend;
      a.extractFailed = event.failed;
      break;
    }
    case "evaluate":
      attemptOf(turn, event.attempt).evaluation = { flagged: event.flagged, reason: event.reason, details: event.details };
      break;
    case "regenerate":
      turn.regenerateReason = event.reason;
      break;
    case "fallback":
      turn.fallback = true;
      break;
    case "toshio":
      turn.toshio = { interjected: event.interjected, skipped: event.skipped };
      break;
    case "saved":
      turn.saved = { newFactIds: event.newFactIds, strategy: event.strategy };
      break;
  }

  turn.attempts.sort((a, b) => a.attempt - b.attempt);
  return next.slice(-MAX_TURNS);
}

/** パネルに並べる段の順番。届いていない段は点灯しない */
export const STAGE_ORDER = ["analyze", "directive", "generate", "extract", "evaluate", "toshio"] as const;
export type StageName = (typeof STAGE_ORDER)[number];

export const STAGE_LABEL: Record<StageName, string> = {
  analyze: "analyze",
  directive: "directive",
  generate: "generate",
  extract: "extract",
  evaluate: "evaluate",
  toshio: "としお",
};

export const QUESTION_TYPE_LABEL: Record<string, string> = {
  impression: "感想",
  memory_check: "記憶の確認",
  theory: "考察",
  fact_question: "事実の質問",
  doubt: "疑い",
  other: "その他",
};

export const DIRECTIVE_LABEL: Record<string, string> = {
  introduce: "新しい設定を1つ",
  layer: "裏付けを重ねる",
  plain: "素の返答",
};

export const TOSHIO_SKIP_LABEL: Record<string, string> = {
  cooldown: "連投防止",
  material: "材料なし",
  declined: "見送り",
  failed: "失敗",
};

export const PHASE_LABEL: Record<string, string> = { early: "序盤", middle: "中盤", late: "終盤" };

/** その段まで進んだか。点灯の判定に使う */
export function stageReached(turn: TraceTurn, stage: StageName): boolean {
  const last = turn.attempts[turn.attempts.length - 1];
  switch (stage) {
    case "analyze":
      return Boolean(turn.analyze);
    case "directive":
      return Boolean(turn.directive);
    case "generate":
      return Boolean(last?.message);
    case "extract":
      return Boolean(last?.claims);
    case "evaluate":
      return Boolean(last?.evaluation);
    case "toshio":
      return Boolean(turn.toshio);
  }
}

/** 段の1行サマリ。まだ来ていなければ null */
export function stageSummary(turn: TraceTurn, stage: StageName): string | null {
  if (!stageReached(turn, stage)) return null;
  const last = turn.attempts[turn.attempts.length - 1];
  switch (stage) {
    case "analyze": {
      const a = turn.analyze!;
      const words = [...a.mentionedCharacters, ...a.mentionedEvents];
      const kind = QUESTION_TYPE_LABEL[a.questionType] ?? a.questionType;
      return words.length > 0 ? `${kind} / ${words.join("・")}` : kind;
    }
    case "directive": {
      const d = turn.directive!;
      const base = DIRECTIVE_LABEL[d.kind] ?? d.kind;
      return d.kind === "layer" && d.detailCount ? `${base}（${d.detailCount}つ）` : base;
    }
    case "generate":
      return turn.attempts.length > 1 ? `${turn.attempts.length}回目 / ${last.message!.length}字` : `${last.message!.length}字`;
    case "extract": {
      // 取り出しに使ったバックエンド（gemini / local）を1語だけ添える
      const via = last.extractBackend ? ` / ${last.extractBackend}` : "";
      if (last.extractFailed) return `取り出せず${via}`;
      return `${last.claims!.length === 0 ? "主張なし" : `${last.claims!.length}件`}${via}`;
    }
    case "evaluate": {
      const e = last.evaluation!;
      if (!e.flagged) return "矛盾なし";
      return e.details[0] ?? e.reason ?? "差し戻し";
    }
    case "toshio": {
      const t = turn.toshio!;
      return t.interjected ? "割り込み" : (TOSHIO_SKIP_LABEL[t.skipped ?? ""] ?? "なし");
    }
  }
}
