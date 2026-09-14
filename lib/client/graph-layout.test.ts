import { describe, expect, it } from "vitest";
import { layoutGraph } from "./graph-layout";
import type { RevealGraph } from "@/lib/server/types";

const graph: RevealGraph = {
  nodes: [
    { id: "entity:a", kind: "entity", label: "A", known: true },
    { id: "statement:1", kind: "statement", statementId: "1", verdict: "lie", label: "x", number: 1 },
    { id: "statement:2", kind: "statement", statementId: "2", verdict: "true", label: "y", number: 2 },
    { id: "canon:c", kind: "canon", label: "c", episodeFrom: 1 },
    { id: "toshio:t", kind: "toshio", messageId: "t", label: "t" },
  ],
  edges: [
    { id: "e1", from: "entity:a", to: "statement:1", kind: "subject" },
    { id: "e2", from: "entity:a", to: "statement:2", kind: "subject" },
    { id: "e3", from: "statement:1", to: "canon:c", kind: "based_on" },
    { id: "e4", from: "toshio:t", to: "statement:1", kind: "rode_on" },
  ],
};

describe("layoutGraph", () => {
  it("全ノードを枠の中に置き、同じ入力なら同じ位置になる", () => {
    const a = layoutGraph(graph);
    const b = layoutGraph(graph);
    expect(a.nodes.length).toBe(5);
    for (const n of a.nodes) {
      expect(n.x).toBeGreaterThanOrEqual(n.r);
      expect(n.y).toBeGreaterThanOrEqual(n.r);
      expect(n.x).toBeLessThanOrEqual(a.width - n.r);
      expect(n.y).toBeLessThanOrEqual(a.height - n.r);
      expect(Number.isFinite(n.x) && Number.isFinite(n.y)).toBe(true);
    }
    expect(a.nodes.map((n) => [n.x, n.y])).toEqual(b.nodes.map((n) => [n.x, n.y]));
  });

  it("ノードどうしが重ならない", () => {
    const { nodes } = layoutGraph(graph);
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const d = Math.hypot(nodes[i].x - nodes[j].x, nodes[i].y - nodes[j].y);
        expect(d).toBeGreaterThan(nodes[i].r + nodes[j].r);
      }
    }
  });

  it("空のグラフでも落ちない", () => {
    const l = layoutGraph({ nodes: [], edges: [] });
    expect(l.nodes).toEqual([]);
    expect(l.width).toBeGreaterThan(0);
  });
});
