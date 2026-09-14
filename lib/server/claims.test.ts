import { test } from "vitest";
import assert from "node:assert/strict";
import { buildNormalizer, findContradiction, findDuplicate, normalizeTriple } from "./claims";
import type { Entity, FabricatedFact } from "./types";

const entities: Entity[] = [
  { id: "hachiware", workId: "w", name: "ハチワレ", aliases: ["はちわれ", "ハチ"] },
  { id: "usagi", workId: "w", name: "うさぎ", aliases: ["ウサギ"] },
];
const normalize = buildNormalizer(entities);

function fact(partial: Partial<FabricatedFact>): FabricatedFact {
  return {
    id: "fake_1",
    sessionId: "s",
    subject: "ハチワレ",
    relation: "origin",
    object: "猫",
    negated: false,
    claim: "",
    sourceCanonFactIds: [],
    introducedMessageId: "m",
    confidence: 1,
    status: "active",
    createdAt: "",
    ...partial,
  };
}

test("aliases normalize to the canonical entity name", () => {
  assert.equal(normalize("はちわれ"), "ハチワレ");
  assert.equal(normalize("「ウサギ」"), "うさぎ");
  assert.equal(normalize("知らない誰か "), "知らない誰か");
});

test("functional relation with a different object contradicts", () => {
  const claim = normalizeTriple({ subject: "はちわれ", relation: "origin", object: "犬", negated: false }, normalize);
  assert.ok(findContradiction(claim, fact({})));
});

test("non-functional relation with a different object coexists", () => {
  const claim = normalizeTriple({ subject: "ハチワレ", relation: "has", object: "カメラ", negated: false }, normalize);
  assert.equal(findContradiction(claim, fact({ relation: "has", object: "さすまた" })), null);
});

test("same triple with opposite negation contradicts", () => {
  const claim = { subject: "ハチワレ", relation: "has" as const, object: "カメラ", negated: true };
  assert.ok(findContradiction(claim, fact({ relation: "has", object: "カメラ" })));
});

test("polar pair on the same object contradicts", () => {
  const claim = { subject: "ハチワレ", relation: "dislikes" as const, object: "ラーメン", negated: false };
  assert.ok(findContradiction(claim, fact({ relation: "likes", object: "ラーメン" })));
  assert.equal(findContradiction({ ...claim, object: "カレー" }, fact({ relation: "likes", object: "ラーメン" })), null);
});

test("different subject never contradicts", () => {
  const claim = { subject: "うさぎ", relation: "origin" as const, object: "犬", negated: false };
  assert.equal(findContradiction(claim, fact({})), null);
});

test("duplicate detection reuses the stored fact", () => {
  const claim = normalizeTriple({ subject: "ハチ", relation: "origin", object: "猫", negated: false }, normalize);
  assert.equal(findDuplicate(claim, [fact({})])?.id, "fake_1");
});
