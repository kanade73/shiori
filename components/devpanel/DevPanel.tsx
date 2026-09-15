"use client";

import { useEffect, useMemo, useState } from "react";
import { RevealGraph } from "@/components/reveal/RevealGraph";
import { TurnTrace } from "./TurnTrace";
import { PHASE_LABEL, reduceTurns, type TraceTurn } from "./trace";
import type { DevEventsGraph, DevEventsInit, PipelineEvent } from "@/lib/server/events";
import type { RevealGraph as RevealGraphData } from "@/lib/server/reveal/types";
import type { SessionPhase } from "@/lib/server/types";

/**
 * 開発者モードの右パネル。チャットの裏でパイプラインが何をしたかを、その場で見せる。
 * debug 専用の SSE（GET /api/sessions/[id]/events）だけを読み、チャットの表示には触らない。
 */

const PHASES: SessionPhase[] = ["early", "middle", "late"];

type PanelState = {
  phase: SessionPhase;
  limits: DevEventsInit["limits"] | null;
  fabricatedFactCount: number;
  graph: RevealGraphData | null;
  newFactIds: string[];
};

function PhaseGauge({ phase }: { phase: SessionPhase }) {
  const index = PHASES.indexOf(phase);
  return (
    <div className="flex gap-[3px]" data-testid="phase-gauge" data-phase={phase}>
      {PHASES.map((p, i) => (
        <span
          key={p}
          className={`h-[4px] flex-1 rounded-pill ${i <= index ? "bg-primary" : "bg-primary-disabled"}`}
          aria-hidden="true"
        />
      ))}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-xs">
      <span className="text-[11px] text-muted">{label}</span>
      <span className="font-mono text-[11px] text-ink">{value}</span>
    </div>
  );
}

function Section({ title, children, note }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <section className="border-b border-hairline px-sm py-xs last:border-b-0">
      <div className="flex items-baseline justify-between gap-xs">
        <h3 className="text-[11px] font-medium tracking-[0.08em] text-muted">{title}</h3>
        {note && <span className="font-mono text-[10px] text-muted-soft">{note}</span>}
      </div>
      <div className="mt-xs">{children}</div>
    </section>
  );
}

export function DevPanel({ sessionId, onClose }: { sessionId: string; onClose: () => void }) {
  const [turns, setTurns] = useState<TraceTurn[]>([]);
  const [connected, setConnected] = useState(false);
  const [state, setState] = useState<PanelState>({
    phase: "early",
    limits: null,
    fabricatedFactCount: 0,
    graph: null,
    newFactIds: [],
  });

  useEffect(() => {
    if (typeof EventSource === "undefined") return;
    const source = new EventSource(`/api/sessions/${sessionId}/events`);

    source.addEventListener("open", () => setConnected(true));
    source.addEventListener("init", (e) => {
      const data = JSON.parse((e as MessageEvent).data) as DevEventsInit;
      setConnected(true);
      setState({
        phase: data.phase,
        limits: data.limits,
        fabricatedFactCount: data.fabricatedFactCount,
        graph: data.graph,
        newFactIds: [],
      });
    });
    source.addEventListener("stage", (e) => {
      const event = JSON.parse((e as MessageEvent).data) as PipelineEvent;
      setTurns((prev) => reduceTurns(prev, event));
      if (event.stage === "directive") setState((s) => ({ ...s, phase: event.phase }));
    });
    source.addEventListener("graph", (e) => {
      const data = JSON.parse((e as MessageEvent).data) as DevEventsGraph;
      setState({
        phase: data.phase,
        limits: data.limits,
        fabricatedFactCount: data.fabricatedFactCount,
        graph: data.graph,
        newFactIds: data.newFactIds,
      });
    });
    source.addEventListener("error", () => setConnected(false));

    return () => source.close();
  }, [sessionId]);

  const highlightNodeIds = useMemo(() => state.newFactIds.map((id) => `statement:${id}`), [state.newFactIds]);
  const ordered = useMemo(() => [...turns].reverse(), [turns]);

  return (
    <aside
      className="hidden w-[340px] shrink-0 flex-col border-l border-hairline bg-surface-soft lg:flex"
      data-testid="dev-panel"
      aria-label="開発者モード"
    >
      <header className="flex h-16 shrink-0 items-center justify-between border-b border-hairline px-sm">
        <div className="flex items-center gap-xs">
          <span className="text-[13px] font-medium text-ink">開発者モード</span>
          <span
            className={`h-[6px] w-[6px] rounded-pill ${connected ? "bg-success" : "bg-primary-disabled"}`}
            data-testid="dev-panel-connection"
            data-connected={connected ? "true" : "false"}
          />
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md px-xs py-xxs text-[12px] text-muted transition-colors hover:bg-surface-card hover:text-ink"
        >
          閉じる
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <Section title="進行度" note={PHASE_LABEL[state.phase]}>
          <PhaseGauge phase={state.phase} />
          <div className="mt-xs flex flex-col gap-[3px]">
            <Stat label="嘘" value={`${state.fabricatedFactCount}件`} />
            <Stat
              label="連続嘘の上限"
              value={state.limits ? (state.limits.lieStreakLimit === null ? "なし" : `${state.limits.lieStreakLimit}`) : "-"}
            />
            <Stat label="裏付けの数" value={state.limits ? `${state.limits.layerDetailCount}` : "-"} />
            <Stat label="としおの間隔" value={state.limits ? `${state.limits.toshioCooldownTurns}ターン` : "-"} />
          </div>
        </Section>

        <Section title="パイプライン" note={turns.length > 0 ? `${turns.length}ターン` : undefined}>
          {ordered.length === 0 ? (
            <p className="text-[11px] text-muted-soft">送信すると、ここに流れが出ます。</p>
          ) : (
            <div className="flex flex-col gap-xxs">
              {ordered.map((turn, i) => (
                <TurnTrace key={turn.id} turn={turn} open={i === 0} />
              ))}
            </div>
          )}
        </Section>

        <Section title="育つ嘘のグラフ">
          {state.graph && state.graph.nodes.length > 0 ? (
            <RevealGraph graph={state.graph} highlightNodeIds={highlightNodeIds} compact onNavigate={() => {}} />
          ) : (
            <p className="text-[11px] text-muted-soft">嘘はまだありません。</p>
          )}
        </Section>
      </div>
    </aside>
  );
}
