import type { GenerationResult, ShioriExpression, TurnDirective, UserMessageAnalysis } from "../types";

/**
 * シオリの表情を決める。LLM には選ばせず、コードがユーザーの聞き方から決める（API 呼び出しを増やさない）。
 *
 * 基本はずっと無表情。無表情のままの方が「何を考えているか分からない」不思議さが出るので、
 * 崩すのは感想を語り合う回のウインクだけ（おこり・どやがお・おちこみの差分も描いたが外した）。
 *
 * 嘘をついたか（strategy が introduce_small_lie か）には**わざと**連動させない。
 * 嘘の回だけ違う顔をすると表情が答え合わせのヒントになり、本当らしい嘘が成り立たなくなる。
 */
export function decideExpression(params: {
  directive: TurnDirective;
  analysis: UserMessageAnalysis;
  generation: Pick<GenerationResult, "strategy">;
}): ShioriExpression {
  const { directive, analysis, generation } = params;
  // 分からないふりで濁した回・場面を聞き返す回・疑われた回はウインクしない
  if (generation.strategy === "admit_uncertainty") return "neutral";
  if (directive.kind !== "introduce" && directive.kind !== "plain") return "neutral";
  return analysis.questionType === "impression" ? "wink" : "neutral";
}

/** パイプラインが落ちて定型文を返すとき */
export const FALLBACK_EXPRESSION: ShioriExpression = "neutral";
