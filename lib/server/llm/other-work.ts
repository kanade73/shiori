import { Type } from "@google/genai";
import { ai, ROUTER_MODEL } from "./client";
import { OtherWorkJudgementSchema, type OtherWorkJudgement } from "./schemas";

/**
 * 別の作品の判定役（issue #1 ナックルベンチ）。発話に本作の名前でも外部資料の語でもない
 * 固有名詞らしいカタカナ語があるとき（other-work.ts のゲートを通ったとき）だけ呼ぶ。
 *
 * web 検索は使わない（無料枠のキーでは Google 検索グラウンディングが 429 になる）。
 * モデルの一般知識で「ナックル・ユピー → HUNTER×HUNTER」と分かれば十分で、分からなければ
 * 空文字を返して本作の話として扱う（誤って別作品扱いにする方が会話を壊す）。
 * 話題の切り替わりの判定役と同じ軽いモデル・小さな文脈で、シオリの無料枠は削らない。
 */

const SYSTEM_PROMPT = `あなたはアニメ・マンガ作品についての会話の進行係です。
ユーザーは、ある作品（本作）についてキャラクターと話しています。
ユーザーの最新の発言に、本作の登場人物・用語・作品名のどれでもなく、本作の資料にも見当たらないカタカナの語がありました。

# 判定
- その語が**別の作品**（アニメ・マンガ・ゲーム・小説など）の登場人物・用語・技・場面の名前で、ユーザーが別の作品の話をしていると確信できるなら、その作品の正式なタイトルを otherWork に書く（例: HUNTER×HUNTER）。
- 本作の登場人物・用語かもしれない、一般名詞・製品名・比喩・擬音・人名でも作品が特定できない、確信が持てない、のどれかなら otherWork は空文字。
- 迷ったら空文字。誤って別作品扱いにする方が会話を壊す。`;

const responseSchema = {
  type: Type.OBJECT,
  properties: {
    otherWork: { type: Type.STRING },
  },
  required: ["otherWork"],
};

export async function judgeOtherWork(params: {
  workTitle: string;
  userMessage: string;
  /** 本作の名前でも外部資料の語でもないカタカナ語 */
  names: string[];
}): Promise<OtherWorkJudgement> {
  const { workTitle, userMessage, names } = params;
  const prompt = `# 本作
${workTitle}

# ユーザーの最新の発言
${userMessage}

# 本作の資料に見当たらない語
${names.map((n) => `- ${n}`).join("\n")}`;

  const response = await ai.models.generateContent({
    model: ROUTER_MODEL,
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    config: {
      systemInstruction: SYSTEM_PROMPT,
      responseMimeType: "application/json",
      responseSchema,
      maxOutputTokens: 128,
    },
  });

  const parsed = OtherWorkJudgementSchema.parse(JSON.parse(response.text || "{}"));
  return { otherWork: parsed.otherWork.trim() };
}
