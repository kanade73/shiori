import type { Claim, ClaimRelation, Entity, FabricatedFact } from "./types";

/**
 * Deterministic side of lie consistency. The model is free to say anything
 * (that is the fun part); this module only decides whether a new claim
 * contradicts something the character already said in this session.
 *
 * Two claims are compared on normalized (subject, relation, object) triples:
 *  - same triple with opposite `negated`                      -> contradiction
 *  - a "functional" relation with the same subject but a
 *    different object (e.g. two different origins)             -> contradiction
 *  - a polar pair (likes/dislikes, can/cannot) on the same
 *    subject and object                                        -> contradiction
 * Anything else is allowed to coexist.
 */

export const CLAIM_RELATIONS: readonly ClaimRelation[] = [
  "is",
  "identity",
  "origin",
  "lives_in",
  "first_appeared",
  "has",
  "likes",
  "dislikes",
  "fears",
  "can",
  "cannot",
  "did",
  "related_to",
  "secret",
  "other",
];

/** Relations for which a subject can have only one object. */
const FUNCTIONAL_RELATIONS: ReadonlySet<ClaimRelation> = new Set(["identity", "origin", "lives_in", "first_appeared"]);

const POLAR_PAIRS: ReadonlyArray<[ClaimRelation, ClaimRelation]> = [
  ["likes", "dislikes"],
  ["can", "cannot"],
];

function polarOpposite(relation: ClaimRelation): ClaimRelation | null {
  for (const [a, b] of POLAR_PAIRS) {
    if (relation === a) return b;
    if (relation === b) return a;
  }
  return null;
}

export function normalizeText(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[「」『』"'（）()【】\s]/g, "")
    .replace(/[、。,.!?！？]+$/g, "")
    .trim();
}

export type Normalizer = (text: string) => string;

/** Builds a normalizer that maps any alias of a known entity to its canonical name. */
export function buildNormalizer(entities: Entity[]): Normalizer {
  const aliasToName = new Map<string, string>();
  for (const entity of entities) {
    aliasToName.set(normalizeText(entity.name), entity.name);
    for (const alias of entity.aliases) aliasToName.set(normalizeText(alias), entity.name);
  }
  return (text: string) => {
    const key = normalizeText(text);
    return aliasToName.get(key) ?? key;
  };
}

export type Triple = { subject: string; relation: ClaimRelation; object: string; negated: boolean };

export function normalizeTriple<T extends Triple>(claim: T, normalize: Normalizer): T {
  return { ...claim, subject: normalize(claim.subject), object: normalize(claim.object) };
}

export function sameTriple(a: Triple, b: Triple): boolean {
  return a.subject === b.subject && a.relation === b.relation && a.object === b.object && a.negated === b.negated;
}

export type Contradiction = {
  claim: Triple;
  existing: FabricatedFact;
  reason: string;
};

export function isClaimRelation(value: string): value is ClaimRelation {
  return (CLAIM_RELATIONS as readonly string[]).includes(value);
}

/**
 * The contradiction rules above, for any two triples (a new claim against a stored
 * lie, or against a canon fact). Returns why they contradict, or null if they can coexist.
 * Both inputs must already be normalized with the same Normalizer.
 */
export function contradictionReason(claim: Triple, other: Triple): string | null {
  if (claim.subject !== other.subject) return null;

  if (claim.relation === other.relation) {
    if (claim.object === other.object && claim.negated !== other.negated) {
      return "同じ主張を肯定と否定の両方で述べている";
    }
    if (FUNCTIONAL_RELATIONS.has(claim.relation) && !claim.negated && !other.negated && claim.object !== other.object) {
      return `${claim.relation} は1つに決まる関係なのに別の値を述べている`;
    }
    return null;
  }

  const opposite = polarOpposite(claim.relation);
  if (opposite && other.relation === opposite && claim.object === other.object && !claim.negated && !other.negated) {
    return "正反対の関係を同じ対象に述べている";
  }
  return null;
}

/** Both inputs must already be normalized with the same Normalizer. */
export function findContradiction(claim: Triple, existing: FabricatedFact): Contradiction | null {
  const reason = contradictionReason(claim, existing);
  return reason ? { claim, existing, reason } : null;
}

export function findContradictions(claim: Triple, existing: FabricatedFact[]): Contradiction[] {
  const found: Contradiction[] = [];
  for (const fact of existing) {
    const c = findContradiction(claim, fact);
    if (c) found.push(c);
  }
  return found;
}

/** Returns the stored fact that is the same statement as `claim`, if any (so we reuse instead of duplicating). */
export function findDuplicate(claim: Triple, existing: FabricatedFact[]): FabricatedFact | null {
  return existing.find((fact) => sameTriple(claim, fact)) ?? null;
}

export function isFabricated(claim: Claim): boolean {
  return claim.grounding === "fabricated";
}
