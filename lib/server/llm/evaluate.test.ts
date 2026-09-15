import { describe, expect, it } from "vitest";
import { evaluateGeneration } from "./evaluate";
import { buildNormalizer } from "../claims";
import type { CanonFact, Claim, Entity, FabricatedFact } from "../types";

// issue #26: 本物の設定との照合も、嘘どうしと同じ矛盾のルール（claims.ts）で行う。
// 以前は「主語と関係が同じで目的語が違う」だけで矛盾とみなし、話題の事実に「モモンガ did …」が
// あると、モモンガの嘘（did）が毎回弾かれて濁し返答になっていた。

const entities: Entity[] = [{ id: "hachiware", workId: "w", name: "ハチワレ", aliases: ["ハチ"] }];
const normalize = buildNormalizer(entities);

function canon(partial: Partial<CanonFact>): CanonFact {
  return {
    id: "topic-1-1",
    workId: "w",
    episodeFrom: 0,
    subject: "モモンガ",
    relation: "did",
    object: "労働の鎧さんに無茶振りをし駄々をこねる",
    description: "労働の鎧さんに無茶振りをして駄々をこねる。",
    ...partial,
  };
}

function lie(partial: Partial<Claim>): Claim {
  return {
    subject: "モモンガ",
    relation: "did",
    object: "床の石ころを一度だけ右足で蹴飛ばす",
    negated: false,
    claim: "モモンガは床の石ころを一度だけ右足で蹴飛ばした。",
    grounding: "fabricated",
    sourceCanonFactIds: [],
    ...partial,
  };
}

function stored(partial: Partial<FabricatedFact>): FabricatedFact {
  return {
    id: "fake_1",
    sessionId: "s",
    subject: "モモンガ",
    relation: "origin",
    object: "モモンガ",
    negated: false,
    claim: "モモンガの由来はモモンガ。",
    sourceCanonFactIds: [],
    introducedMessageId: "m",
    confidence: 1,
    status: "active",
    createdAt: "",
    ...partial,
  };
}

function evaluate(claims: Claim[], canonFacts: CanonFact[], existing: FabricatedFact[] = []) {
  return evaluateGeneration({
    result: { message: "", strategy: "no_new_lie", claims },
    visibleCanonFacts: canonFacts,
    existingFabricatedFacts: existing,
    normalize,
  });
}

describe("evaluateGeneration: 本物の設定との照合", () => {
  it("同じキャラの別の出来事・持ち物・性質は、本物の設定の横に足してよい（差し戻さない）", () => {
    const facts = [
      canon({}),
      canon({ id: "topic-1-2", relation: "has", object: "大きな瞳とふわふわの尻尾" }),
      canon({ id: "topic-1-3", relation: "is", object: "攻撃的な言動で周囲を煽る性格" }),
    ];
    const result = evaluate(
      [lie({}), lie({ relation: "has", object: "青いリボン" }), lie({ relation: "is", object: "寒がり" })],
      facts,
    );
    expect(result.shouldRegenerate).toBe(false);
    expect(result.canonContradictionScore).toBe(0);
    expect(result.details).toEqual([]);
  });

  it("1つに決まる関係（由来・正体・住まい・初登場）で別の値を言えば差し戻す", () => {
    const result = evaluate(
      [lie({ subject: "ハチ", relation: "origin", object: "犬", claim: "ハチワレのモチーフは犬。" })],
      [canon({ subject: "ハチワレ", relation: "origin", object: "はちわれ猫", description: "はちわれ猫がモチーフ。" })],
    );
    expect(result.shouldRegenerate).toBe(true);
    expect(result.details[0]).toContain("はちわれ猫がモチーフ。");
    expect(result.details[0]).toContain("1つに決まる関係");
  });

  it("本物の設定をそのまま否定すれば差し戻す", () => {
    const result = evaluate([lie({ object: "労働の鎧さんに無茶振りをし駄々をこねる", negated: true })], [canon({})]);
    expect(result.shouldRegenerate).toBe(true);
  });

  it("好き嫌い・できるできないを反対にすれば差し戻す", () => {
    const result = evaluate(
      [lie({ relation: "can", object: "うさぎに勝つ" })],
      [canon({ relation: "cannot", object: "うさぎに勝つ" })],
    );
    expect(result.shouldRegenerate).toBe(true);
  });

  it("関係が自由記述の本物の設定（work.json の canonFacts）とは照合しない", () => {
    const result = evaluate(
      [lie({ subject: "ハチワレ", relation: "origin", object: "犬" })],
      [canon({ subject: "ハチワレ", relation: "モチーフにしている", object: "はちわれ猫" })],
    );
    expect(result.shouldRegenerate).toBe(false);
  });

  it("本物の設定に基づく主張（canon）は照合しない", () => {
    const result = evaluate([lie({ grounding: "canon", relation: "origin", object: "犬" })], [canon({ relation: "origin", object: "モモンガ" })]);
    expect(result.shouldRegenerate).toBe(false);
  });

  it("既に語った嘘との矛盾は、これまでどおり差し戻す", () => {
    const result = evaluate([lie({ relation: "origin", object: "ムササビ" })], [], [stored({})]);
    expect(result.shouldRegenerate).toBe(true);
    expect(result.reason).toBe("既に語った設定と矛盾している");
  });
});
