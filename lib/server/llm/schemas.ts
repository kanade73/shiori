import { z } from "zod";
import { CLAIM_RELATIONS } from "../claims";

/**
 * extract.ts がモデルに出させる1件分の主張。
 * grounding / sourceCanonFactIds はモデルに出させない（canonFacts との照合で
 * コードが決める）ので、ここには無い。
 */
export const ExtractedClaimSchema = z.object({
  subject: z.string(),
  relation: z.enum(CLAIM_RELATIONS),
  object: z.string(),
  negated: z.boolean(),
  claim: z.string().optional(),
  quote: z.string().optional(),
});

export const ExtractedClaimsSchema = z.object({
  claims: z.array(ExtractedClaimSchema),
});

// generate.ts はプレーンテキストを返すだけなのでスキーマを持たない
// （返答文以外を出させないことが分離の狙い）。

export const ToshioCommentarySchema = z.object({
  shouldComment: z.boolean(),
  message: z.string(),
});
