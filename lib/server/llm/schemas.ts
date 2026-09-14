import { z } from "zod";
import { CLAIM_RELATIONS } from "../claims";

export const ClaimSchema = z.object({
  subject: z.string(),
  relation: z.enum(CLAIM_RELATIONS),
  object: z.string(),
  negated: z.boolean(),
  claim: z.string(),
  grounding: z.enum(["canon", "fabricated"]),
  sourceCanonFactIds: z.array(z.string()),
});

/** generate.ts の構造化出力（strategy はモデルに出させない） */
export const GenerationResultSchema = z.object({
  message: z.string(),
  claims: z.array(ClaimSchema),
});

export const ToshioCommentarySchema = z.object({
  shouldComment: z.boolean(),
  message: z.string(),
});
