import { z } from "zod";
import { CLAIM_RELATIONS } from "../claims";

/**
 * extract.ts がモデルに出させる1件分の主張。
 * grounding / sourceCanonFactIds はモデルに出させない（canonFacts との照合で
 * コードが決める）ので、ここには無い。
 *
 * `relation` はここでは自由な文字列で受ける。閉じた語彙（CLAIM_RELATIONS）かどうかの
 * 検証は extract.ts が1件ずつ行い、語彙外は**その1件だけ**捨てる。スキーマで enum に
 * しておくと、ローカルの推論サーバが1件だけ語彙外を返したときに全件を失うため。
 */
export const ExtractedClaimSchema = z.object({
  subject: z.string(),
  relation: z.string(),
  object: z.string(),
  negated: z.boolean().optional(),
  claim: z.string().optional(),
  /** 返答文からの抜き出し。答え合わせで本文中の位置を示すのに使う。省略可 */
  quote: z.string().optional(),
});

/** 1件ずつ検証して落とすため、配列の中身は unknown のまま受ける。 */
export const ExtractedClaimsSchema = z.object({
  claims: z.array(z.unknown()),
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

// generate.ts はプレーンテキストを返すだけなのでスキーマを持たない
// （返答文以外を出させないことが分離の狙い）。

export const ToshioCommentarySchema = z.object({
  shouldComment: z.boolean(),
  message: z.string(),
});
