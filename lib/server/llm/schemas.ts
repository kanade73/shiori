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
  quote: z.string().optional(),
});

/** 会話の話題の特定（issue #14）。外部の資料から、ユーザーが話したい場面とその事実を抜き出したもの */
export const TopicExtractionSchema = z.object({
  found: z.boolean(),
  title: z.string(),
  summary: z.string(),
  chunkIds: z.array(z.string()),
  facts: z.array(
    z.object({
      subject: z.string(),
      relation: z.enum(CLAIM_RELATIONS),
      object: z.string(),
      description: z.string(),
      chunkId: z.string(),
    }),
  ),
});

export type TopicExtraction = z.infer<typeof TopicExtractionSchema>;

export const ToshioCommentarySchema = z.object({
  shouldComment: z.boolean(),
  message: z.string(),
});

export const GenerationResultSchema = z.object({
  message: z.string(),
  strategy: z.enum([
    "no_new_lie",
    "introduce_small_lie",
    "reinforce_existing_lie",
    "avoid_spoiler",
    "admit_uncertainty",
  ]),
  claims: z.array(ClaimSchema),
  usedExistingFactIds: z.array(z.string()),
  spoilerRisk: z.number().min(0).max(1),
});
