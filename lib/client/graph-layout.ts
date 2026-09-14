import type { RevealGraph, RevealGraphNode } from "@/lib/server/types";

/**
 * 嘘の構造図のレイアウト。小さな力学モデル（反発 + 辺のばね + 中心への引力）を
 * 決まった回数だけ回す。乱数は使わず、初期位置は種類ごとの同心円に並べるので、
 * 同じ入力なら同じ絵になる。ノード数は多くても数十なので O(n²) で足りる。
 */

export type LaidOutNode = { node: RevealGraphNode; x: number; y: number; r: number };

export type GraphLayout = {
  nodes: LaidOutNode[];
  byId: Map<string, LaidOutNode>;
  width: number;
  height: number;
};

/** ノードの半径（見た目の大きさ。反発の距離にも使う） */
export function radiusOf(node: RevealGraphNode): number {
  switch (node.kind) {
    case "entity":
      return 26;
    case "statement":
      return 16;
    case "canon":
      return 11;
    case "toshio":
      return 20;
  }
}

/** 種類ごとの初期半径。主語を内側に、主張をその周り、本物の設定ととしおを外側に */
function ringOf(node: RevealGraphNode): number {
  switch (node.kind) {
    case "entity":
      return 80;
    case "statement":
      return 220;
    case "canon":
      return 360;
    case "toshio":
      return 330;
  }
}

const EDGE_LENGTH = { subject: 150, object: 160, based_on: 120, rode_on: 130 } as const;

export function layoutGraph(graph: RevealGraph, options: { iterations?: number; padding?: number } = {}): GraphLayout {
  const iterations = options.iterations ?? 320;
  const padding = options.padding ?? 48;

  const nodes: LaidOutNode[] = [];
  const byKind = new Map<RevealGraphNode["kind"], number>();
  const countByKind = new Map<RevealGraphNode["kind"], number>();
  for (const n of graph.nodes) countByKind.set(n.kind, (countByKind.get(n.kind) ?? 0) + 1);

  // 種類ごとに角度を等分し、種類の間で位相をずらして重なりを避ける
  const phase: Record<RevealGraphNode["kind"], number> = { entity: 0, statement: 0.5, canon: 0.25, toshio: 0.75 };
  for (const n of graph.nodes) {
    const i = byKind.get(n.kind) ?? 0;
    byKind.set(n.kind, i + 1);
    const count = countByKind.get(n.kind) ?? 1;
    const angle = ((i + phase[n.kind]) / count) * Math.PI * 2 - Math.PI / 2;
    const ring = count === 1 && n.kind === "entity" ? 0 : ringOf(n);
    nodes.push({ node: n, x: Math.cos(angle) * ring, y: Math.sin(angle) * ring, r: radiusOf(n) });
  }
  const byId = new Map(nodes.map((n) => [n.node.id, n]));

  const springs = graph.edges.flatMap((e) => {
    const a = byId.get(e.from);
    const b = byId.get(e.to);
    return a && b ? [{ a, b, length: EDGE_LENGTH[e.kind] + a.r + b.r }] : [];
  });

  const vx = new Map<LaidOutNode, number>();
  const vy = new Map<LaidOutNode, number>();
  for (const n of nodes) {
    vx.set(n, 0);
    vy.set(n, 0);
  }

  for (let step = 0; step < iterations; step++) {
    const temperature = 1 - step / iterations;
    // 反発
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i];
        const b = nodes[j];
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        let d2 = dx * dx + dy * dy;
        if (d2 < 1e-4) {
          // 完全に重なったら決まった向きにずらす
          dx = 0.01 * (i + 1);
          dy = 0.01 * (j + 1);
          d2 = dx * dx + dy * dy;
        }
        const d = Math.sqrt(d2);
        // ラベルが下に付くので、横方向は余分に離す（dx を縮めて測ると横に広がる）
        const minGap = a.r + b.r + 70;
        const ax = dx * 0.7;
        const ad2 = ax * ax + dy * dy;
        const force = (minGap * minGap * 1.8) / Math.max(ad2, 1e-4) + (d < minGap ? (minGap - d) * 0.8 : 0);
        const fx = (dx / d) * force;
        const fy = (dy / d) * force;
        vx.set(a, vx.get(a)! - fx);
        vy.set(a, vy.get(a)! - fy);
        vx.set(b, vx.get(b)! + fx);
        vy.set(b, vy.get(b)! + fy);
      }
    }
    // 辺のばね
    for (const { a, b, length } of springs) {
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const d = Math.max(Math.sqrt(dx * dx + dy * dy), 1e-3);
      const force = (d - length) * 0.08;
      const fx = (dx / d) * force;
      const fy = (dy / d) * force;
      vx.set(a, vx.get(a)! + fx);
      vy.set(a, vy.get(a)! + fy);
      vx.set(b, vx.get(b)! - fx);
      vy.set(b, vy.get(b)! - fy);
    }
    // 中心への引力（孤立したものが飛んでいかないように）と適用
    for (const n of nodes) {
      const fx = vx.get(n)! - n.x * 0.01;
      const fy = vy.get(n)! - n.y * 0.01;
      const limit = 24 * temperature + 1;
      const len = Math.sqrt(fx * fx + fy * fy);
      const scale = len > limit ? limit / len : 1;
      n.x += fx * scale;
      n.y += fy * scale;
      vx.set(n, 0);
      vy.set(n, 0);
    }
  }

  // 原点を左上に寄せて、ラベルの分の余白を足す
  const minX = Math.min(...nodes.map((n) => n.x - n.r), 0) - padding;
  const minY = Math.min(...nodes.map((n) => n.y - n.r), 0) - padding;
  const maxX = Math.max(...nodes.map((n) => n.x + n.r), 0) + padding;
  const maxY = Math.max(...nodes.map((n) => n.y + n.r), 0) + padding + 16;
  for (const n of nodes) {
    n.x = Math.round((n.x - minX) * 10) / 10;
    n.y = Math.round((n.y - minY) * 10) / 10;
  }

  return { nodes, byId, width: Math.ceil(maxX - minX), height: Math.ceil(maxY - minY) };
}
