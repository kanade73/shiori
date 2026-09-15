"use client";

import { useState } from "react";
import { STAGE_LABEL, STAGE_ORDER, stageReached, stageSummary, type TraceTurn } from "./trace";

/**
 * 1発話ぶんのパイプライン。analyze → generate → extract → evaluate →（差し戻し）→
 * としお判断 の順に段が点灯し、それぞれの結果を1行で出す。
 */

function ClaimChip({ grounding, label }: { grounding: "canon" | "fabricated"; label: string }) {
  const tone = grounding === "fabricated" ? "border-error/40 bg-error/10 text-error" : "border-success/40 bg-success/10 text-success";
  return <span className={`inline-block max-w-full truncate rounded-xs border px-[5px] py-[1px] text-[10px] ${tone}`}>{label}</span>;
}

function StageRow({ turn, stage }: { turn: TraceTurn; stage: (typeof STAGE_ORDER)[number] }) {
  const lit = stageReached(turn, stage);
  const summary = stageSummary(turn, stage);
  return (
    <div className="flex items-baseline gap-xs" data-testid={`stage-${stage}`} data-lit={lit ? "true" : "false"}>
      <span className="flex items-center gap-[5px]">
        <span className={`h-[6px] w-[6px] shrink-0 rounded-pill ${lit ? "bg-primary" : "bg-primary-disabled"}`} />
        <span className={`w-[62px] shrink-0 font-mono text-[10px] ${lit ? "text-body" : "text-muted-soft"}`}>
          {STAGE_LABEL[stage]}
        </span>
      </span>
      <span className={`min-w-0 flex-1 truncate text-[11px] ${lit ? "text-ink" : "text-muted-soft"}`}>{summary ?? "…"}</span>
    </div>
  );
}

export function TurnTrace({ turn, open: defaultOpen }: { turn: TraceTurn; open: boolean }) {
  // 既定は「最新のターンだけ開く」。一度でも自分で開閉したら、その選択を優先する。
  const [override, setOverride] = useState<boolean | null>(null);
  const open = override ?? defaultOpen;
  const setOpen = (next: (v: boolean) => boolean) => setOverride(next(open));
  const last = turn.attempts[turn.attempts.length - 1];
  const claims = last?.claims ?? [];

  return (
    <div className="rounded-md border border-hairline bg-canvas" data-testid="turn-trace">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-xs px-xs py-[6px] text-left"
        aria-expanded={open}
      >
        <span className="min-w-0 flex-1 truncate text-[11px] text-body">{turn.userText || "（発話）"}</span>
        {turn.saved && turn.saved.newFactIds.length > 0 && (
          <span className="shrink-0 rounded-xs bg-error/10 px-[5px] py-[1px] text-[10px] text-error">
            +{turn.saved.newFactIds.length}
          </span>
        )}
        <span className="shrink-0 text-[10px] text-muted-soft">{open ? "−" : "+"}</span>
      </button>

      {open && (
        <div className="flex flex-col gap-[3px] border-t border-hairline-soft px-xs py-xs">
          {STAGE_ORDER.map((stage) => (
            <StageRow key={stage} turn={turn} stage={stage} />
          ))}

          {claims.length > 0 && (
            <div className="mt-[3px] flex flex-wrap gap-[3px]" data-testid="turn-claims">
              {claims.map((c, i) => (
                <ClaimChip key={`${c.subject}-${c.relation}-${c.object}-${i}`} grounding={c.grounding} label={c.claim} />
              ))}
            </div>
          )}

          {turn.regenerateReason && (
            <p className="mt-[3px] rounded-xs bg-surface-card px-[5px] py-[3px] text-[10px] leading-[1.5] text-muted" data-testid="turn-regenerate">
              差し戻し: {turn.regenerateReason}
            </p>
          )}
          {turn.fallback && (
            <p className="text-[10px] text-error" data-testid="turn-fallback">
              2回とも差し戻し。濁した返答に差し替え
            </p>
          )}
        </div>
      )}
    </div>
  );
}
