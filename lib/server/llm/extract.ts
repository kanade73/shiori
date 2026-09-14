import { Type } from "@google/genai";
import { ai, GENERATION_MODEL } from "./client";
import { ClaimsOutputSchema } from "./schemas";
import { CLAIM_RELATIONS } from "../claims";
import type { CanonFact, Claim } from "../types";

/**
 * シオリの返答文から「作品の設定に関する主張」を取り出す事務的な呼び出し。
 * 生成（generate.ts）から分けることで、会話中のモデルに自己監視をさせない。
 * 取り出した claims は evaluate（矛盾・ネタバレ検査）と FabricatedFact の保存に使う。
 */
const EXTRACT_PROMPT = `あなたはアニメ考察チャットの返答文を検査する記録係です。
渡された「返答文」の中で述べられている、作品の設定に関する主張を**すべて**列挙してください。
感想や相槌は主張ではありません。設定に触れていなければ空配列で構いません。
記録漏れは後で矛盾を生むので、迷ったら入れてください。

各主張は subject / relation / object / negated に分解します。
- subject と object はキャラクター名・場所・物などの名詞。呼び名は作品での正式な名前に揃える
- relation は次から選ぶ:
  is（性質・属性）, identity（正体・本名・種族）, origin（由来・元ネタ・モチーフ）, lives_in（住んでいる場所）,
  first_appeared（初登場の場面・時期）, has（所有）, likes, dislikes, fears, can, cannot,
  did（過去にした行為・出来事）, related_to（家族・師弟・因縁などの関係）, secret（隠している事実）, other
- negated は「〜ではない」「〜していない」のような否定の主張なら true
- claim は主張を一文にしたもの
- grounding は、渡された「本物の設定」のどれかに基づく主張なら canon、それ以外（返答文が作った設定）なら fabricated
- sourceCanonFactIds は canon のとき根拠にした設定の id。fabricated なら空配列`;

const claimsResponseSchema = {
  type: Type.OBJECT,
  properties: {
    claims: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          subject: { type: Type.STRING },
          relation: { type: Type.STRING, enum: [...CLAIM_RELATIONS] },
          object: { type: Type.STRING },
          negated: { type: Type.BOOLEAN },
          claim: { type: Type.STRING },
          grounding: { type: Type.STRING, enum: ["canon", "fabricated"] },
          sourceCanonFactIds: { type: Type.ARRAY, items: { type: Type.STRING } },
        },
        required: ["subject", "relation", "object", "negated", "claim", "grounding", "sourceCanonFactIds"],
      },
    },
  },
  required: ["claims"],
};

function formatCanonFacts(facts: CanonFact[]): string {
  if (facts.length === 0) return "（なし）";
  return facts.map((f) => `- [${f.id}] ${f.subject} / ${f.relation} / ${f.object}: ${f.description}`).join("\n");
}

export async function extractClaims(params: {
  workTitle: string;
  message: string;
  /** 生成に渡したのと同じ視聴済み範囲の設定。grounding の判定材料 */
  canonFacts: CanonFact[];
}): Promise<Claim[]> {
  const { workTitle, message, canonFacts } = params;

  const input = `# 作品
${workTitle}

# 本物の設定
${formatCanonFacts(canonFacts)}

# 返答文
${message}`;

  const response = await ai.models.generateContent({
    model: GENERATION_MODEL,
    contents: [{ role: "user", parts: [{ text: input }] }],
    config: {
      systemInstruction: EXTRACT_PROMPT,
      responseMimeType: "application/json",
      responseSchema: claimsResponseSchema,
      maxOutputTokens: 2048,
    },
  });

  const text = response.text || "{}";
  try {
    return ClaimsOutputSchema.parse(JSON.parse(text)).claims;
  } catch (err) {
    throw new Error(`Failed to parse claims output: ${err}`);
  }
}
