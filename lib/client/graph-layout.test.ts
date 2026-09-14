import { describe, expect, it } from "vitest";
import { isForwardEdge, layoutGraph } from "./graph-layout";
import type { RevealGraph } from "@/lib/server/types";

// 嘘の構造図は左から右へ一方向: 本物の設定 → キャラ・物 → 主張（会話順に上から下） → としお

const graph: RevealGraph = {
  nodes: [
    { id: "statement:2", kind: "statement", statementId: "2", verdict: "true", label: "y", number: 2 },
    { id: "entity:a", kind: "entity", label: "A", known: true },
    { id: "toshio:t", kind: "toshio", messageId: "t", label: "としおの考察 1" },
    { id: "statement:1", kind: "statement", statementId: "1", verdict: "lie", label: "x", number: 1 },
    { id: "canon:c", kind: "canon", label: "c", episodeFrom: 1 },
  ],
  edges: [
    { id: "e1", from: "entity:a", to: "statement:1", kind: "subject", label: "持つ" },
    { id: "e2", from: "entity:a", to: "statement:2", kind: "subject" },
    { id: "e3", from: "statement:1", to: "canon:c", kind: "based_on" },
    { id: "e4", from: "toshio:t", to: "statement:1", kind: "rode_on" },
    { id: "e5", from: "statement:2", to: "entity:a", kind: "object" },
  ],
};

describe("layoutGraph", () => {
  it("列は 本物の設定 → キャラ → 主張 → としお の順に左から並ぶ", () => {
    const l = layoutGraph(graph);
    expect(l.columns.map((c) => c.kind)).toEqual(["canon", "entity", "statement", "toshio"]);
    const x = (id: string) => l.byId.get(id)!.x;
    expect(x("canon:c")).toBeLessThan(x("entity:a"));
    expect(x("entity:a")).toBeLessThan(x("statement:1"));
    expect(x("statement:1")).toBeLessThan(x("toshio:t"));
  });

  it("主張は番号順に上から下へ、他の列はつながった主張の高さに寄る", () => {
    const l = layoutGraph(graph);
    const s1 = l.byId.get("statement:1")!;
    const s2 = l.byId.get("statement:2")!;
    expect(s1.y).toBeLessThan(s2.y);
    const canon = l.byId.get("canon:c")!;
    expect(Math.abs(canon.y + canon.h / 2 - (s1.y + s1.h / 2))).toBeLessThan(4);
    const toshio = l.byId.get("toshio:t")!;
    expect(Math.abs(toshio.y + toshio.h / 2 - (s1.y + s1.h / 2))).toBeLessThan(6);
  });

  it("描く辺は右向きのものだけ（目的語の辺は落とす）", () => {
    const l = layoutGraph(graph);
    expect(l.edges.map((e) => e.edge.id)).toEqual(["e1", "e2", "e3", "e4"]);
    expect(isForwardEdge({ id: "x", from: "a", to: "b", kind: "object" })).toBe(false);
  });

  it("同じ列のノードは重ならず、全部が枠に収まる", () => {
    const l = layoutGraph(graph);
    for (const n of l.nodes) {
      expect(n.x).toBeGreaterThanOrEqual(0);
      expect(n.y).toBeGreaterThanOrEqual(0);
      expect(n.x + n.w).toBeLessThanOrEqual(l.width);
      expect(n.y + n.h).toBeLessThanOrEqual(l.height);
    }
    const byKind = new Map<string, typeof l.nodes>();
    for (const n of l.nodes) byKind.set(n.node.kind, [...(byKind.get(n.node.kind) ?? []), n]);
    for (const items of byKind.values()) {
      const sorted = [...items].sort((a, b) => a.y - b.y);
      for (let i = 1; i < sorted.length; i++) expect(sorted[i].y).toBeGreaterThanOrEqual(sorted[i - 1].y + sorted[i - 1].h);
    }
  });

  it("空のグラフでも落ちない", () => {
    const l = layoutGraph({ nodes: [], edges: [] });
    expect(l.nodes).toEqual([]);
    expect(l.columns).toEqual([]);
    expect(l.width).toBeGreaterThan(0);
  });
});

describe("layoutGraph の辺の向き", () => {
  it("描画上はデータの向きに関わらず、左の列から右の列へ向く", () => {
    const l = layoutGraph(graph);
    for (const e of l.edges) expect(e.from.x).toBeLessThanOrEqual(e.to.x);
    const basedOn = l.edges.find((e) => e.edge.id === "e3")!;
    expect(basedOn.from.node.kind).toBe("canon");
    const rodeOn = l.edges.find((e) => e.edge.id === "e4")!;
    expect(rodeOn.to.node.kind).toBe("toshio");
  });
});
