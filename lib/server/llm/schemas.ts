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
  /** 返答文からの抜き出し。答え合わせで本文中の位置を示すのに使う。省略可 */
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

/** 話題の切り替わりの判定役の出力。shift=false なら query は無視してよい */
export const TopicRouteSchema = z.object({
  shift: z.boolean(),
  query: z.string(),
});

export type TopicRoute = z.infer<typeof TopicRouteSchema>;

/** generate.ts の構造化出力（strategy はモデルに出させない） */
export const GenerationResultSchema = z.object({
  message: z.string(),
  claims: z.array(ClaimSchema),
});

export const ToshioCommentarySchema = z.object({
  shouldComment: z.boolean(),
  message: z.string(),
});
