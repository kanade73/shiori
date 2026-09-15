"use client";

import { useMemo, useState } from "react";
import { layoutGraph, type LaidOutEdge, type LaidOutNode } from "@/lib/client/graph-layout";
import type { RevealGraph as RevealGraphData, RevealGraphEdge, RevealGraphNode, Verdict } from "@/lib/server/reveal/types";

/**
 * 嘘の構造図。左から右へ「本物の設定 → キャラ・物 → シオリの主張 → としお」と一方向に流れる。
 * 主張は会話に出た順に上から下。ノードを押すと、ふりかえりの該当箇所へ飛ぶ。
 */

const VERDICT_STROKE: Record<Verdict, string> = { lie: "stroke-error", true: "stroke-success" };
const VERDICT_FILL: Record<Verdict, string> = { lie: "fill-error", true: "fill-success" };
const VERDICT_FILL_SOFT: Record<Verdict, string> = { lie: "fill-error/10", true: "fill-success/10" };

const EDGE_STYLE: Record<RevealGraphEdge["kind"], { className: string; marker: string; dash?: string; width: number }> = {
  subject: { className: "stroke-muted-soft", marker: "url(#arrow-muted)", width: 1.5 },
  based_on: { className: "stroke-warning", marker: "url(#arrow-warning)", dash: "5 4", width: 1.5 },
  rode_on: { className: "stroke-primary", marker: "url(#arrow-primary)", dash: "2 4", width: 2 },
  object: { className: "stroke-accent-steel", marker: "", width: 1.5 }, // 図には描かない（逆向きになるため）
};

function trimLabel(text: string, max: number) {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

export function statementAnchorId(statementId: string) {
  return `statement-${statementId}`;
}

export function toshioAnchorId(messageId: string) {
  return `message-${messageId}`;
}

function anchorOf(node: RevealGraphNode): string | null {
  if (node.kind === "statement") return statementAnchorId(node.statementId);
  if (node.kind === "toshio") return toshioAnchorId(node.messageId);
  return null;
}

function titleOf(node: RevealGraphNode): string {
  switch (node.kind) {
    case "statement":
      return `${node.number}. ${node.verdict === "lie" ? "嘘" : "本当"}: ${node.label}`;
    case "canon":
      return `本物の設定（第${node.episodeFrom}話〜）: ${node.label}`;
    default:
      return node.label;
  }
}

/** 右向きのなめらかな曲線。左のノードの右端から、右のノードの左端へ */
function edgePath(e: LaidOutEdge): string {
  const x1 = e.from.x + e.from.w;
  const y1 = e.from.y + e.from.h / 2;
  const x2 = e.to.x - 4; // 矢印の先の分
  const y2 = e.to.y + e.to.h / 2;
  const cx = (x1 + x2) / 2;
  return `M${x1},${y1} C${cx},${y1} ${cx},${y2} ${x2},${y2}`;
}

function NodeShape({
  item,
  dimmed,
  active,
  highlighted,
}: {
  item: LaidOutNode;
  dimmed: boolean;
  active: boolean;
  highlighted?: boolean;
}) {
  const { node, w, h } = item;
  const common = `transition-opacity duration-200 ${dimmed ? "opacity-25" : "opacity-100"}`;
  const ring =
    active || highlighted ? (
      <rect
        x={-3}
        y={-3}
        width={w + 6}
        height={h + 6}
        rx={h / 2 + 3}
        className={`fill-none stroke-primary ${highlighted && !active ? "animate-fade-up" : ""}`}
        strokeWidth={1.5}
      />
    ) : null;

  switch (node.kind) {
    case "statement":
      return (
        <g className={common}>
          {ring}
          <rect width={w} height={h} rx={h / 2} className={`${VERDICT_FILL_SOFT[node.verdict]} ${VERDICT_STROKE[node.verdict]}`} strokeWidth={1.5} />
          <circle cx={h / 2} cy={h / 2} r={11} className={VERDICT_FILL[node.verdict]} />
          <text x={h / 2} y={h / 2} textAnchor="middle" dominantBaseline="central" className="fill-on-primary text-[11px] font-semibold" style={{ pointerEvents: "none" }}>
            {node.number}
          </text>
          <text x={h + 4} y={h / 2} dominantBaseline="central" className="fill-ink text-[12px]" style={{ pointerEvents: "none" }}>
            {trimLabel(node.label, 15)}
          </text>
        </g>
      );
    case "entity":
      return (
        <g className={common}>
          {ring}
          <rect width={w} height={h} rx={h / 2} className={node.known ? "fill-primary" : "fill-accent-mauve"} />
          <text x={w / 2} y={h / 2} textAnchor="middle" dominantBaseline="central" className="fill-on-primary text-[12px] font-medium" style={{ pointerEvents: "none" }}>
            {trimLabel(node.label, 6)}
          </text>
        </g>
      );
    case "canon":
      return (
        <g className={common}>
          {ring}
          <rect width={w} height={h} rx={6} className="fill-canvas stroke-warning" strokeWidth={1.5} strokeDasharray="4 3" />
          <text x={10} y={13} className="fill-muted text-[10px]" style={{ pointerEvents: "none" }}>
            第{node.episodeFrom}話〜
          </text>
          <text x={10} y={29} className="fill-body text-[11px]" style={{ pointerEvents: "none" }}>
            {trimLabel(node.label, 13)}
          </text>
        </g>
      );
    case "toshio":
      return (
        <g className={common}>
          {ring}
          <clipPath id={`clip-${node.id}`}>
            <circle cx={22} cy={h / 2} r={18} />
          </clipPath>
          <rect width={w} height={h} rx={h / 2} className="fill-canvas stroke-hairline" strokeWidth={1} />
          <circle cx={22} cy={h / 2} r={19} className="fill-canvas stroke-primary" strokeWidth={1.5} />
          <image href="/character/toshio-64.png" x={4} y={h / 2 - 18} width={36} height={36} clipPath={`url(#clip-${node.id})`} preserveAspectRatio="xMidYMid slice" />
          <text x={46} y={h / 2} dominantBaseline="central" className="fill-body text-[11px]" style={{ pointerEvents: "none" }}>
            {node.label.replace("としおの考察 ", "考察 ")}
          </text>
        </g>
      );
  }
}

function LegendItem({ children, label }: { children: React.ReactNode; label: string }) {
  return (
    <span className="inline-flex items-center gap-[5px]">
      <svg width="26" height="14" viewBox="0 0 26 14" aria-hidden="true">
        {children}
      </svg>
      <span>{label}</span>
    </span>
  );
}

export function RevealGraph({
  graph,
  onNavigate,
  highlightNodeIds,
  compact,
}: {
  graph: RevealGraphData;
  onNavigate?: (anchorId: string) => void;
  /** 直前に増えたノード。軽く強調する */
  highlightNodeIds?: string[];
  /** 見出し・説明・凡例を省き、図だけを出す（開発者モードのパネル用） */
  compact?: boolean;
}) {
  const layout = useMemo(() => layoutGraph(graph), [graph]);
  const highlighted = useMemo(() => new Set(highlightNodeIds ?? []), [highlightNodeIds]);
  const [hovered, setHovered] = useState<string | null>(null);

  const neighbors = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const { edge } of layout.edges) {
      if (!map.has(edge.from)) map.set(edge.from, new Set());
      if (!map.has(edge.to)) map.set(edge.to, new Set());
      map.get(edge.from)!.add(edge.to);
      map.get(edge.to)!.add(edge.from);
    }
    return map;
  }, [layout.edges]);

  const statements = graph.nodes.filter((n) => n.kind === "statement");
  if (statements.length === 0) return null;

  const lies = statements.filter((n) => n.kind === "statement" && n.verdict === "lie").length;
  const canonCount = graph.nodes.filter((n) => n.kind === "canon").length;
  const toshioCount = graph.nodes.filter((n) => n.kind === "toshio").length;

  const isDimmed = (id: string) => hovered !== null && hovered !== id && !neighbors.get(hovered)?.has(id);
  const isEdgeDimmed = (e: RevealGraphEdge) => hovered !== null && e.from !== hovered && e.to !== hovered;

  function navigate(node: RevealGraphNode) {
    const anchor = anchorOf(node);
    if (!anchor) return;
    if (onNavigate) onNavigate(anchor);
    else document.getElementById(anchor)?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  return (
    <section
      className={compact ? "" : "mt-sm rounded-lg border border-hairline bg-canvas px-md py-sm"}
      data-testid="reveal-graph"
    >
      {!compact && (
        <>
          <div className="flex flex-wrap items-baseline justify-between gap-x-sm gap-y-xxs">
            <h2 className="text-title-sm font-medium text-ink">嘘の構造図</h2>
            <p className="text-[12px] text-muted">
              {lies > 0 ? `嘘 ${lies}件` : "語られた設定"}
              {canonCount > 0 ? `は本物の設定 ${canonCount}件の上に` : "は"}
              {toshioCount > 0 ? `乗り、としおの考察 ${toshioCount}回に広がりました` : "あります"}
            </p>
          </div>
          <p className="mt-xxs text-[12px] leading-[1.6] text-muted">
            左から右へ、本物の設定がキャラの話になり、シオリの主張（上から会話順）になり、としおの考察に広がる流れです。ノードを押すと、ふりかえりの該当箇所へ飛びます。
          </p>
        </>
      )}

      <div className={`overflow-x-auto ${compact ? "" : "mt-xs"}`}>
        <svg
          viewBox={`0 0 ${layout.width} ${layout.height}`}
          width="100%"
          style={{ display: "block", maxWidth: layout.width, minWidth: Math.min(layout.width, compact ? 360 : 640) }}
          role="img"
          aria-label="嘘の構造図"
          onMouseLeave={() => setHovered(null)}
        >
          <defs>
            {(
              [
                ["arrow-muted", "fill-muted-soft"],
                ["arrow-warning", "fill-warning"],
                ["arrow-primary", "fill-primary"],
              ] as const
            ).map(([id, cls]) => (
              <marker key={id} id={id} viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
                <path d="M0,0.5 L8,4 L0,7.5 z" className={cls} />
              </marker>
            ))}
          </defs>

          {layout.columns.map((c) => (
            <text key={c.kind} x={c.x} y={14} className="fill-muted-soft text-[11px] font-medium">
              {c.title}
            </text>
          ))}

          {layout.edges.map((e) => {
            const style = EDGE_STYLE[e.edge.kind];
            const dimmed = isEdgeDimmed(e.edge);
            const labelX = (e.from.x + e.from.w + e.to.x) / 2;
            const labelY = (e.from.y + e.from.h / 2 + e.to.y + e.to.h / 2) / 2;
            return (
              <g key={e.edge.id} className={`transition-opacity duration-200 ${dimmed ? "opacity-15" : "opacity-100"}`}>
                <path d={edgePath(e)} className={`fill-none ${style.className}`} strokeWidth={style.width} strokeDasharray={style.dash} markerEnd={style.marker} />
                {e.edge.label && (
                  <g>
                    <rect x={labelX - e.edge.label.length * 4.5 - 3} y={labelY - 7} width={e.edge.label.length * 9 + 6} height={14} rx={7} className="fill-canvas" />
                    <text x={labelX} y={labelY} textAnchor="middle" dominantBaseline="central" className="fill-muted text-[9px]">
                      {e.edge.label}
                    </text>
                  </g>
                )}
              </g>
            );
          })}

          {layout.nodes.map((item) => {
            const clickable = anchorOf(item.node) !== null;
            const title = titleOf(item.node);
            return (
              <g
                key={item.node.id}
                transform={`translate(${item.x}, ${item.y})`}
                data-node-kind={item.node.kind}
                data-highlighted={highlighted.has(item.node.id) ? "true" : undefined}
                onMouseEnter={() => setHovered(item.node.id)}
                onFocus={() => setHovered(item.node.id)}
                onBlur={() => setHovered(null)}
                onClick={() => navigate(item.node)}
                onKeyDown={(ev) => {
                  if (ev.key === "Enter" || ev.key === " ") {
                    ev.preventDefault();
                    navigate(item.node);
                  }
                }}
                tabIndex={clickable ? 0 : -1}
                role={clickable ? "button" : undefined}
                aria-label={title}
                style={{ cursor: clickable ? "pointer" : "default", outline: "none" }}
              >
                <title>{title}</title>
                <NodeShape
                  item={item}
                  dimmed={isDimmed(item.node.id)}
                  active={hovered === item.node.id}
                  highlighted={highlighted.has(item.node.id)}
                />
              </g>
            );
          })}
        </svg>
      </div>

      <div className={`mt-xs flex-wrap gap-x-sm gap-y-xxs text-[11px] text-muted ${compact ? "hidden" : "flex"}`}>
        <LegendItem label="嘘">
          <rect x="2" y="2" width="22" height="10" rx="5" className="fill-error/10 stroke-error" strokeWidth={1.5} />
        </LegendItem>
        <LegendItem label="本当">
          <rect x="2" y="2" width="22" height="10" rx="5" className="fill-success/10 stroke-success" strokeWidth={1.5} />
        </LegendItem>
        <LegendItem label="キャラ・物">
          <rect x="2" y="2" width="22" height="10" rx="5" className="fill-primary" />
        </LegendItem>
        <LegendItem label="元にした本物の設定">
          <line x1="2" y1="7" x2="22" y2="7" className="stroke-warning" strokeWidth={1.5} strokeDasharray="4 3" />
        </LegendItem>
        <LegendItem label="どのキャラの話か">
          <line x1="2" y1="7" x2="22" y2="7" className="stroke-muted-soft" strokeWidth={1.5} />
        </LegendItem>
        <LegendItem label="嘘の上に乗ったとしお">
          <line x1="2" y1="7" x2="22" y2="7" className="stroke-primary" strokeWidth={2} strokeDasharray="2 4" />
        </LegendItem>
      </div>
    </section>
  );
}
