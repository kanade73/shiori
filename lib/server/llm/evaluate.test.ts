import { describe, expect, it } from "vitest";
import { buildNormalizer } from "../claims";
import type { CanonFact, Claim, ClaimRelation, FabricatedFact } from "../types";
import { evaluateGeneration } from "./evaluate";

const normalize = buildNormalizer([{ id: "person", workId: "w", name: "人物", aliases: ["あの人"] }]);
const canon: CanonFact = {
  id: "canon-1", workId: "w", episodeFrom: 1, subject: "人物", relation: "did",
  object: "試験に合格した", description: "人物は試験に合格した。",
};
const claim: Claim = {
  subject: "人物", relation: "did", object: "メモを落とした", negated: false,
  grounding: "fabricated", claim: "人物はメモを落とした。", sourceCanonFactIds: [],
};
function check(claims: Claim[], facts: CanonFact[] = [canon], existingFabricatedFacts: FabricatedFact[] = []) {
  return evaluateGeneration({ result: { message: "返答", claims, strategy: "no_new_lie" },
    visibleCanonFacts: facts, existingFabricatedFacts, normalize });
}

describe("canonとの整合: 別の行動や複数の属性は共存できる", () => {
  it("試験に合格したこととメモを落としたことを矛盾にしない", () => {
    expect(check([claim]).shouldRegenerate).toBe(false);
    expect(check([claim]).details).toEqual([]);
  });

  it.each(["did", "has", "is", "likes", "other"] as ClaimRelation[])("%s はobjectが違っても上書き扱いしない", (relation) => {
    expect(check([{ ...claim, relation }], [{ ...canon, relation }]).shouldRegenerate).toBe(false);
  });

  it("単一値の関係でも別の値の否定は矛盾しない（洞窟に住む/海には住まない）", () => {
    expect(check([{ ...claim, relation: "lives_in", object: "海", negated: true }],
      [{ ...canon, relation: "lives_in", object: "洞窟" }]).shouldRegenerate).toBe(false);
  });

  it("未知の自由記述relationの意味を推定しない", () => {
    expect(check([{ ...claim, relation: "lives_in", object: "海" }],
      [{ ...canon, relation: "住んでいる", object: "洞窟" }]).shouldRegenerate).toBe(false);
  });
});

describe("本物の設定への明確な矛盾は検出する", () => {
  it.each(["identity", "origin", "lives_in", "first_appeared"] as ClaimRelation[])("%s の別の値への上書き", (relation) => {
    expect(check([{ ...claim, relation }], [{ ...canon, relation }]).shouldRegenerate).toBe(true);
  });

  it("同じ三つ組の否定（合格した/合格していない）", () => {
    const result = check([{ ...claim, object: canon.object, negated: true }]);
    expect(result.shouldRegenerate).toBe(true);
    expect(result.details[0]).toContain(canon.description);
    expect(result.details[0]).toContain("肯定と否定");
  });

  it.each([["likes", "dislikes"], ["can", "cannot"]] as [ClaimRelation, ClaimRelation][])("%s / %s の反対関係", (positive, negative) => {
    expect(check([{ ...claim, relation: negative, object: canon.object }],
      [{ ...canon, relation: positive }]).shouldRegenerate).toBe(true);
  });

  it("正反対のrelationでも対象が違えば共存する", () => {
    expect(check([{ ...claim, relation: "dislikes", object: "雨" }],
      [{ ...canon, relation: "likes", object: "雪" }]).shouldRegenerate).toBe(false);
  });

  it("canon側も正式名・別名と表記を正規化する", () => {
    expect(check([{ ...claim, subject: "あの人", relation: "lives_in", object: "海" }],
      [{ ...canon, subject: "「人物」", relation: " LIVES_IN ", object: "洞窟" }]).shouldRegenerate).toBe(true);
  });

  it("矛盾を他の主張で薄めても、1件あれば差し戻す", () => {
    const valid = { ...claim, grounding: "canon" as const, object: canon.object, sourceCanonFactIds: [canon.id] };
    const result = check([valid, valid, valid, { ...claim, object: canon.object, negated: true }]);
    expect(result.canonContradictionScore).toBe(0.25);
    expect(result.shouldRegenerate).toBe(true);
  });

  it("本物の設定をそのまま述べる返答は通す", () => {
    expect(check([{ ...claim, object: canon.object, grounding: "canon", sourceCanonFactIds: [canon.id] }]).shouldRegenerate).toBe(false);
  });

  it("canonと共存できる行動でも、既存の嘘を否定していれば差し戻す", () => {
    const existing: FabricatedFact = {
      ...claim, id: "lie-1", sessionId: "s", introducedMessageId: "m", confidence: 1,
      status: "active", createdAt: "2026-01-01T00:00:00Z",
    };
    const result = check([{ ...claim, negated: true }], [canon], [existing]);
    expect(result.canonContradictionScore).toBe(0);
    expect(result.fabricatedConsistencyScore).toBe(0);
    expect(result.shouldRegenerate).toBe(true);
  });
});
