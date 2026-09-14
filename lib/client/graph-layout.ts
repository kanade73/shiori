import type { RevealGraph, RevealGraphEdge, RevealGraphNode } from "@/lib/server/types";

/**
 * 嘘の構造図のレイアウト。左から右へ一方向に流れる層状の図にする。
 *
 *   本物の設定 ──→ キャラ・物 ──→ シオリの主張 ──→ としお
 *
 * 主張は会話に出た順に上から下へ並べ、他の列はつながっている主張の高さに寄せる。
 * 矢印はすべて右向きで、「主張 → 目的語のキャラ」のように逆向きになる辺は描かない
 * （データには残っているが、図では読み手が向きを追えなくなるので落とす）。
 * 乱数は使わないので、同じ入力なら同じ絵になる。
 */

export type LaidOutNode = { node: RevealGraphNode; x: number; y: number; w: number; h: number };

export type LaidOutEdge = { edge: RevealGraphEdge; from: LaidOutNode; to: LaidOutNode };

export type GraphLayout = {
  nodes: LaidOutNode[];
  edges: LaidOutEdge[];
  byId: Map<string, LaidOutNode>;
  columns: { kind: RevealGraphNode["kind"]; title: string; x: number; w: number }[];
  width: number;
  height: number;
};

const COLUMN_ORDER: RevealGraphNode["kind"][] = ["canon", "entity", "statement", "toshio"];
const COLUMN_TITLE: Record<RevealGraphNode["kind"], string> = {
  canon: "本物の設定",
  entity: "キャラ・物",
  statement: "シオリが語った設定",
  toshio: "としおの考察",
};
const COLUMN_WIDTH: Record<RevealGraphNode["kind"], number> = { canon: 168, entity: 96, statement: 236, toshio: 96 };
const NODE_HEIGHT: Record<RevealGraphNode["kind"], number> = { canon: 40, entity: 34, statement: 36, toshio: 44 };
const COLUMN_GAP = 56;
const ROW_GAP = 14;
const PADDING_X = 16;
const PADDING_TOP = 34; // 列見出しの分
const PADDING_BOTTOM = 16;

/** 図に描く辺だけを残す（右向きに流れるものだけ） */
export function isForwardEdge(e: RevealGraphEdge): boolean {
  return e.kind === "subject" || e.kind === "based_on" || e.kind === "rode_on";
}

/** 同じ列の中で重ならないよう、上から順にずらす（希望の高さになるべく近く） */
function resolveColumn(items: { want: number; h: number }[]): number[] {
  const order = items.map((it, i) => ({ ...it, i })).sort((a, b) => a.want - b.want || a.i - b.i);
  const ys = new Array<number>(items.length);
  let cursor = 0;
  for (const it of order) {
    const y = Math.max(it.want, cursor);
    ys[it.i] = y;
    cursor = y + it.h + ROW_GAP;
  }
  return ys;
}

export function layoutGraph(graph: RevealGraph): GraphLayout {
  const present = COLUMN_ORDER.filter((kind) => graph.nodes.some((n) => n.kind === kind));
  const columns: GraphLayout["columns"] = [];
  let x = PADDING_X;
  for (const kind of present) {
    columns.push({ kind, title: COLUMN_TITLE[kind], x, w: COLUMN_WIDTH[kind] });
    x += COLUMN_WIDTH[kind] + COLUMN_GAP;
  }
  const columnX = new Map(columns.map((c) => [c.kind, c.x]));

  const nodes: LaidOutNode[] = graph.nodes.map((node) => ({
    node,
    x: columnX.get(node.kind) ?? PADDING_X,
    y: 0,
    w: COLUMN_WIDTH[node.kind],
    h: NODE_HEIGHT[node.kind],
  }));
  const byId = new Map(nodes.map((n) => [n.node.id, n]));

  // 1. 主張を会話順に上から下へ
  const statements = nodes
    .filter((n) => n.node.kind === "statement")
    .sort((a, b) => (a.node.kind === "statement" && b.node.kind === "statement" ? a.node.number - b.node.number : 0));
  let y = PADDING_TOP;
  for (const s of statements) {
    s.y = y;
    y += s.h + ROW_GAP;
  }

  // 2. 他の列は、つながっている主張の中央の高さに寄せてから重なりをほどく
  const forward = graph.edges.filter(isForwardEdge);
  const linkedYs = (id: string) =>
    forward
      .filter((e) => e.from === id || e.to === id)
      .map((e) => byId.get(e.from === id ? e.to : e.from))
      .filter((n): n is LaidOutNode => !!n && n.node.kind === "statement")
      .map((n) => n.y + n.h / 2);

  for (const kind of ["canon", "entity", "toshio"] as const) {
    const items = nodes.filter((n) => n.node.kind === kind);
    if (items.length === 0) continue;
    const wants = items.map((n) => {
      const ys = linkedYs(n.node.id);
      const center = ys.length > 0 ? ys.reduce((a, b) => a + b, 0) / ys.length : PADDING_TOP + n.h / 2;
      return { want: Math.max(PADDING_TOP, center - n.h / 2), h: n.h };
    });
    const ys = resolveColumn(wants);
    items.forEach((n, i) => (n.y = ys[i]));
  }

  // 描画上の向きは常に「左の列 → 右の列」。データの向き（主張 → 本物の設定、としお → 主張）とは
  // 別で、読み手が矢印を一方向に追えるようにする
  const edges: LaidOutEdge[] = forward.flatMap((edge) => {
    const a = byId.get(edge.from);
    const b = byId.get(edge.to);
    if (!a || !b) return [];
    return a.x <= b.x ? [{ edge, from: a, to: b }] : [{ edge, from: b, to: a }];
  });

  const width = Math.max(x - COLUMN_GAP + PADDING_X, 320);
  const height = Math.max(...nodes.map((n) => n.y + n.h), PADDING_TOP) + PADDING_BOTTOM;
  return { nodes, edges, byId, columns, width, height };
}
