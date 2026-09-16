import { Type } from "@google/genai";
import { ai, ROUTER_MODEL } from "./client";
import { TopicRouteSchema, type TopicRoute } from "./schemas";
import type { SessionTopic } from "../types";

/**
 * 話題の切り替わりの判定役（issue #14 の続き）。決定的なゲート（topic-shift.ts）が
 * 「切り替わったかもしれない」と見た発話でだけ呼ぶ。
 *
 * シオリの generate に Tool Calling で調べさせる方式は採らなかった。ツールを呼ぶ回は
 * シオリの全文脈（ペルソナ・設定・嘘の一覧・履歴）を2往復送り直すことになり、検索結果の
 * 生の文章もシオリの文脈に積まれる。判定役は話題名・直前の返答・発話・候補の見出しだけの
 * 小さな文脈で済み、無料枠もシオリとは別のモデルの枠を使う。
 */

const SYSTEM_PROMPT = `あなたはアニメ作品についての会話の進行係です。
ユーザーとキャラクターが、ある場面（いまの話題）について話しています。
ユーザーの最新の発言が、いまの話題の続きか、別の場面・エピソード・人物に話題を移そうとしているかを判定してください。

# 判定
- shift=true: いまの話題とは別の場面・エピソード・人物について話したがっている（「そういえば〇〇の回って」「次は〇〇の話がしたい」など）
- shift=false: いまの話題の続き。いまの場面に出てくる人物や物についての質問、感想、相づち、疑い（「それ本当？」）、話のまとめなど
- 迷ったら shift=false

# query（shift=true のときだけ）
新しい話題を資料で探すための検索語。指示語（あれ・その回 など）は会話の流れから具体的な名前に置き換え、
場面や人物を表す名詞と出来事を短く並べる（例: 「パジャマパーティーズ 鳥にさらわれる」）。作品名は入れない。
shift=false なら空文字。`;

const routeResponseSchema = {
  type: Type.OBJECT,
  properties: {
    shift: { type: Type.BOOLEAN },
    query: { type: Type.STRING },
  },
  required: ["shift", "query"],
};

/** 直前の返答は判定の手がかりに要るだけなので、長ければ切って文脈を小さく保つ */
const MAX_REPLY_CHARS = 200;

export async function routeTopicShift(params: {
  workTitle: string;
  topic: SessionTopic;
  /** 直前のキャラクターの返答（あれば） */
  lastReply: string | null;
  userMessage: string;
  /** 発言に近い外部資料の段落の見出し（「『〇〇』編」やキャラ名）。本文は渡さない */
  candidateLabels: string[];
}): Promise<TopicRoute> {
  const { workTitle, topic, lastReply, userMessage, candidateLabels } = params;
  const reply = lastReply && lastReply.length > MAX_REPLY_CHARS ? `${lastReply.slice(0, MAX_REPLY_CHARS)}…` : lastReply;

  const prompt = `# 作品
${workTitle}

# いまの話題
${topic.title}：${topic.summary}

# 直前のキャラクターの返答
${reply ?? "（なし）"}

# ユーザーの最新の発言
${userMessage}

# 資料で発言に近かった項目
${candidateLabels.length > 0 ? candidateLabels.map((l) => `- ${l}`).join("\n") : "（なし）"}`;

  const response = await ai.models.generateContent(
    {
      model: ROUTER_MODEL,
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: {
        systemInstruction: SYSTEM_PROMPT,
        responseMimeType: "application/json",
        responseSchema: routeResponseSchema,
        maxOutputTokens: 256,
      },
    },
    "router",
  );

  const parsed = TopicRouteSchema.parse(JSON.parse(response.text || "{}"));
  return { shift: parsed.shift, query: parsed.shift ? parsed.query.trim() : "" };
}
