import { z } from "zod";

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

// generate.ts はプレーンテキストを返すだけなのでスキーマを持たない
// （返答文以外を出させないことが分離の狙い）。

export const ToshioCommentarySchema = z.object({
  shouldComment: z.boolean(),
  message: z.string(),
});
