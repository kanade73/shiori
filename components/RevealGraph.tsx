"use client";

import { useMemo, useState } from "react";
import { layoutGraph, type LaidOutNode } from "@/lib/client/graph-layout";
import { episodeFromLabel } from "@/lib/client/types";
import type { RevealGraph as RevealGraphData, RevealGraphEdge, RevealGraphNode, Verdict } from "@/lib/server/types";

/**
 * 嘘の構造図。答え合わせの結果で、主張（本当/嘘）・主語になったキャラや物・
 * 嘘が元にした本物の設定・としおが乗った嘘、のつながりを1枚の絵にする。
 * ノードを押すと、ふりかえりの該当箇所へ飛ぶ。
 */

const VERDICT_FILL: Record<Verdict, string> = { lie: "fill-error", true: "fill-success" };
const VERDICT_FILL_SOFT: Record<Verdict, string> = { lie: "fill-error/15", true: "fill-success/15" };
const VERDICT_STROKE: Record<Verdict, string> = { lie: "stroke-error", true: "stroke-success" };

const EDGE_STYLE: Record<RevealGraphEdge["kind"], { className: string; dash?: string; width: number }> = {
  subject: { className: "stroke-muted-soft", width: 1.5 },
  object: { className: "stroke-accent-steel", width: 1.5 },
  based_on: { className: "stroke-warning", dash: "5 4", width: 1.5 },
  rode_on: { className: "stroke-primary", dash: "2 4", width: 2 },
};

/** ノードのラベルに出す文字数。主張は短く、キャラ名は丸の中に収める */
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

function NodeShape({ item, dimmed, active }: { item: LaidOutNode; dimmed: boolean; active: boolean }) {
  const { node, r } = item;
  const common = `transition-opacity duration-200 ${dimmed ? "opacity-25" : "opacity-100"}`;
  const ring = active ? <circle r={r + 5} className="fill-none stroke-primary" strokeWidth={2} /> : null;

  switch (node.kind) {
    case "entity":
      return (
        <g className={common}>
          {ring}
          <circle r={r} className={node.known ? "fill-primary" : "fill-accent-mauve"} />
          <text textAnchor="middle" dominantBaseline="central" className="fill-on-primary text-[11px] font-medium" style={{ pointerEvents: "none" }}>
            {trimLabel(node.label, 5)}
          </text>
        </g>
      );
    case "statement":
      return (
        <g className={common}>
          {ring}
          <circle r={r} className={`${VERDICT_FILL_SOFT[node.verdict]} ${VERDICT_STROKE[node.verdict]}`} strokeWidth={2} />
          <text textAnchor="middle" dominantBaseline="central" className={`${VERDICT_FILL[node.verdict]} text-[12px] font-semibold`} style={{ pointerEvents: "none" }}>
            {node.number}
          </text>
          <text y={r + 13} textAnchor="middle" className="fill-body text-[10px]" style={{ pointerEvents: "none" }}>
            {trimLabel(node.label, 14)}
          </text>
        </g>
      );
    case "canon":
      return (
        <g className={common}>
          {ring}
          <rect x={-r} y={-r} width={r * 2} height={r * 2} rx={3} transform="rotate(45)" className="fill-canvas stroke-warning" strokeWidth={1.5} />
          <text y={r + 13} textAnchor="middle" className="fill-muted text-[9px]" style={{ pointerEvents: "none" }}>
            {episodeFromLabel(node.episodeFrom)} {trimLabel(node.label, 12)}
          </text>
        </g>
      );
    case "toshio":
      return (
        <g className={common}>
          {ring}
          <clipPath id={`clip-${node.id}`}>
            <circle r={r} />
          </clipPath>
          <circle r={r + 1.5} className="fill-canvas stroke-primary" strokeWidth={1.5} />
          <image href="/character/toshio-64.png" x={-r} y={-r} width={r * 2} height={r * 2} clipPath={`url(#clip-${node.id})`} preserveAspectRatio="xMidYMid slice" />
          <text y={r + 13} textAnchor="middle" className="fill-body text-[10px]" style={{ pointerEvents: "none" }}>
            {node.label}
          </text>
        </g>
      );
  }
}

function LegendItem({ children, label }: { children: React.ReactNode; label: string }) {
  return (
    <span className="inline-flex items-center gap-[5px]">
      <svg width="22" height="14" viewBox="0 0 22 14" aria-hidden="true">
        {children}
      </svg>
      <span>{label}</span>
    </span>
  );
}

export function RevealGraph({ graph, onNavigate }: { graph: RevealGraphData; onNavigate?: (anchorId: string) => void }) {
  const layout = useMemo(() => layoutGraph(graph), [graph]);
  const [hovered, setHovered] = useState<string | null>(null);

  const neighbors = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const e of graph.edges) {
      if (!map.has(e.from)) map.set(e.from, new Set());
      if (!map.has(e.to)) map.set(e.to, new Set());
      map.get(e.from)!.add(e.to);
      map.get(e.to)!.add(e.from);
    }
    return map;
  }, [graph.edges]);

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
    <section className="mt-lg rounded-xl bg-surface-card px-md py-md" data-testid="reveal-graph">
      <div className="flex flex-wrap items-baseline justify-between gap-x-sm gap-y-xxs">
        <h2 className="text-title-sm font-medium text-ink">嘘の構造図</h2>
        <p className="text-[12px] text-muted">
          {lies > 0 ? `嘘 ${lies}件が` : "語られた設定が"}
          {canonCount > 0 ? `、本物の設定 ${canonCount}件の上に` : ""}
          {toshioCount > 0 ? `、としおの考察 ${toshioCount}回を巻き込んで` : ""}
          広がっていました
        </p>
      </div>
      <p className="mt-xxs text-[12px] leading-[1.6] text-muted">
        主張は語られた順の番号。線でつながる主張は同じキャラや物の話です。丸を押すと、ふりかえりの該当箇所へ飛びます。
      </p>

      <div className="mt-sm overflow-x-auto rounded-lg border border-hairline bg-canvas">
        <svg
          viewBox={`0 0 ${layout.width} ${layout.height}`}
          width="100%"
          style={{ minWidth: Math.min(layout.width, 520), maxHeight: 560, display: "block" }}
          role="img"
          aria-label="嘘の構造図"
          onMouseLeave={() => setHovered(null)}
        >
          <defs>
            <marker id="arrow-object" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M0,0.5 L8,4 L0,7.5 z" className="fill-accent-steel" />
            </marker>
          </defs>

          {graph.edges.map((e) => {
            const a = layout.byId.get(e.from);
            const b = layout.byId.get(e.to);
            if (!a || !b) return null;
            const style = EDGE_STYLE[e.kind];
            // 線は丸の縁から縁へ引く（矢印が丸に埋もれないように）
            const dx = b.x - a.x;
            const dy = b.y - a.y;
            const d = Math.max(Math.sqrt(dx * dx + dy * dy), 1e-3);
            const x1 = a.x + (dx / d) * a.r;
            const y1 = a.y + (dy / d) * a.r;
            const x2 = b.x - (dx / d) * (b.r + (e.kind === "object" ? 3 : 0));
            const y2 = b.y - (dy / d) * (b.r + (e.kind === "object" ? 3 : 0));
            const mx = (x1 + x2) / 2;
            const my = (y1 + y2) / 2;
            const dimmed = isEdgeDimmed(e);
            return (
              <g key={e.id} className={`transition-opacity duration-200 ${dimmed ? "opacity-15" : "opacity-100"}`}>
                <line
                  x1={x1}
                  y1={y1}
                  x2={x2}
                  y2={y2}
                  className={style.className}
                  strokeWidth={style.width}
                  strokeDasharray={style.dash}
                  strokeLinecap="round"
                  markerEnd={e.kind === "object" ? "url(#arrow-object)" : undefined}
                />
                {e.label && (
                  <g>
                    <rect x={mx - e.label.length * 4.6 - 3} y={my - 7} width={e.label.length * 9.2 + 6} height={14} rx={7} className="fill-canvas" />
                    <text x={mx} y={my} textAnchor="middle" dominantBaseline="central" className="fill-muted text-[9px]">
                      {e.label}
                    </text>
                  </g>
                )}
              </g>
            );
          })}

          {layout.nodes.map((item) => {
            const clickable = anchorOf(item.node) !== null;
            const title =
              item.node.kind === "statement"
                ? `${item.node.number}. ${item.node.verdict === "lie" ? "嘘" : "本当"}: ${item.node.label}`
                : item.node.kind === "canon"
                  ? `本物の設定（${episodeFromLabel(item.node.episodeFrom)}）: ${item.node.label}`
                  : item.node.label;
            return (
              <g
                key={item.node.id}
                transform={`translate(${item.x}, ${item.y})`}
                data-node-kind={item.node.kind}
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
                <NodeShape item={item} dimmed={isDimmed(item.node.id)} active={hovered === item.node.id} />
              </g>
            );
          })}
        </svg>
      </div>

      <div className="mt-xs flex flex-wrap gap-x-sm gap-y-xxs text-[11px] text-muted">
        <LegendItem label="嘘">
          <circle cx="11" cy="7" r="5.5" className="fill-error/15 stroke-error" strokeWidth={1.5} />
        </LegendItem>
        <LegendItem label="本当">
          <circle cx="11" cy="7" r="5.5" className="fill-success/15 stroke-success" strokeWidth={1.5} />
        </LegendItem>
        <LegendItem label="キャラ・物">
          <circle cx="11" cy="7" r="6" className="fill-primary" />
        </LegendItem>
        <LegendItem label="元にした本物の設定">
          <rect x="7" y="3" width="8" height="8" rx="1.5" transform="rotate(45 11 7)" className="fill-canvas stroke-warning" strokeWidth={1.5} />
        </LegendItem>
        <LegendItem label="嘘の上に乗ったとしお">
          <line x1="2" y1="7" x2="20" y2="7" className="stroke-primary" strokeWidth={2} strokeDasharray="2 4" strokeLinecap="round" />
        </LegendItem>
        <LegendItem label="別のキャラ・物への言及">
          <line x1="2" y1="7" x2="20" y2="7" className="stroke-accent-steel" strokeWidth={1.5} />
        </LegendItem>
      </div>
    </section>
  );
}
