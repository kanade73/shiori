import { describe, expect, it } from "vitest";
import { buildRevealGraph, relationLabel, shortLabel } from "./reveal-graph";
import type { Entity, RevealMessage, RevealStatement } from "./types";

// 嘘の構造図: 主張・主語・目的語・本物の設定・としお、のつなぎ方を固定する。

const entities: Entity[] = [
  { id: "e1", workId: "w", name: "ちいかわ", aliases: ["ちい"] },
  { id: "e2", workId: "w", name: "ハチワレ", aliases: ["ハチ"] },
];

function st(id: string, verdict: RevealStatement["verdict"], extra: Partial<RevealStatement> = {}): RevealStatement {
  return {
    id,
    messageId: "m1",
    verdict,
    claim: `${id} の主張`,
    subject: "ちいかわ",
    relation: "has",
    object: "何か",
    negated: false,
    quote: null,
    sources: [],
    ...extra,
  };
}

function toshio(id: string, premiseStatementIds: string[]): RevealMessage {
  return { id, role: "assistant", speaker: "toshio", content: "", createdAt: "", segments: [], statementIds: [], premiseStatementIds };
}

describe("buildRevealGraph", () => {
  it("主張ごとにノードを作り、主語（別名は正式名に寄せる）で束ねる", () => {
    const graph = buildRevealGraph({ statements: [st("a", "lie", { subject: "ちい" }), st("b", "true", { subject: "ちいかわ" })], messages: [] }, entities);
    const entityNodes = graph.nodes.filter((n) => n.kind === "entity");
    expect(entityNodes).toEqual([{ id: "entity:ちいかわ", kind: "entity", label: "ちいかわ", known: true }]);
    expect(graph.nodes.filter((n) => n.kind === "statement").map((n) => n.kind === "statement" && [n.statementId, n.verdict, n.number])).toEqual([
      ["a", "lie", 1],
      ["b", "true", 2],
    ]);
    expect(graph.edges.filter((e) => e.kind === "subject").map((e) => [e.from, e.to, e.label])).toEqual([
      ["entity:ちいかわ", "statement:a", "持つ"],
      ["entity:ちいかわ", "statement:b", "持つ"],
    ]);
  });

  it("目的語は登場人物か他の主張の主語に当たるときだけつなぐ", () => {
    const graph = buildRevealGraph(
      {
        statements: [
          st("a", "lie", { relation: "related_to", object: "ハチ" }),
          st("b", "lie", { object: "レシピ" }),
          st("c", "true", { subject: "古本屋", object: "ちいかわ" }),
        ],
        messages: [],
      },
      entities,
    );
    expect(graph.edges.filter((e) => e.kind === "object").map((e) => [e.from, e.to])).toEqual([
      ["statement:a", "entity:ハチワレ"],
      ["statement:c", "entity:ちいかわ"],
    ]);
    // 「レシピ」は登場人物でも主語でもないのでノードにならない
    expect(graph.nodes.find((n) => n.kind === "entity" && n.label === "レシピ")).toBeUndefined();
    // 「古本屋」は未登録だが主語なので、元の表記のままノードになる
    expect(graph.nodes.find((n) => n.kind === "entity" && n.label === "古本屋")).toMatchObject({ known: false });
  });

  it("元にした本物の設定は canon ノードにまとめ、同じ設定は1つにする", () => {
    const source = { id: "c1", episodeFrom: 7, description: "検定に合格した" };
    const graph = buildRevealGraph({ statements: [st("a", "lie", { sources: [source] }), st("b", "true", { sources: [source] })], messages: [] }, entities);
    expect(graph.nodes.filter((n) => n.kind === "canon")).toEqual([{ id: "canon:c1", kind: "canon", label: "検定に合格した", episodeFrom: 7 }]);
    expect(graph.edges.filter((e) => e.kind === "based_on").map((e) => [e.from, e.to])).toEqual([
      ["statement:a", "canon:c1"],
      ["statement:b", "canon:c1"],
    ]);
  });

  it("としおは嘘に乗ったときだけノードになり、乗った主張につなぐ", () => {
    const graph = buildRevealGraph(
      { statements: [st("a", "lie"), st("b", "lie")], messages: [toshio("x1", ["a", "b"]), toshio("x2", []), toshio("x3", ["missing"])] },
      entities,
    );
    expect(graph.nodes.filter((n) => n.kind === "toshio")).toEqual([{ id: "toshio:x1", kind: "toshio", messageId: "x1", label: "としおの考察 1" }]);
    expect(graph.edges.filter((e) => e.kind === "rode_on").map((e) => e.to)).toEqual(["statement:a", "statement:b"]);
  });

  it("主語が空の主張は、主語の辺を作らない", () => {
    const graph = buildRevealGraph({ statements: [st("a", "lie", { subject: "" })], messages: [] }, entities);
    expect(graph.nodes.filter((n) => n.kind === "entity")).toEqual([]);
    expect(graph.edges).toEqual([]);
  });
});

describe("labels", () => {
  it("関係の語と否定", () => {
    expect(relationLabel("likes", false)).toBe("好き");
    expect(relationLabel("likes", true)).toBe("好き（否定）");
    expect(relationLabel("other", false)).toBe("");
    expect(relationLabel("other", true)).toBe("否定");
  });
  it("長い主張は切る", () => {
    expect(shortLabel("あ".repeat(40), 10)).toBe("あ".repeat(9) + "…");
    expect(shortLabel("短い")).toBe("短い");
  });
});
