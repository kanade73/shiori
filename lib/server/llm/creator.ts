import { Type } from "@google/genai";
import { z } from "zod";
import { ai, GENERATION_MODEL } from "./client";
import type { SourceChunk } from "../types";

/**
 * 作り手の記事から「作風」だけを抜く係。としおが「この作者はこういう描き方をする人だから」と
 * 考察を組む土台にする。実在の人物なので、私生活・発言・経歴は抜かず、作品内の描き方の癖に限る。
 */
const SYSTEM_PROMPT = `あなたはアニメ・漫画の批評の下調べをする資料係です。
渡された資料（作り手についての記事）から、その人の**作風**だけを抜き出してください。

作風とは、作品の中での描き方の癖・傾向です。例:
- 可愛らしい絵柄の奥に不条理や残酷さを置く
- 説明せず、小物や背景で状況を語らせる
- 登場人物の感情を台詞ではなく間や仕草で見せる

守ること:
- 資料に書かれていることだけから抜く。推測で作らない
- 私生活・経歴・受賞・コラボ・商品展開・本人の発言の引用は入れない（作風に関係する範囲で「〜と評される」程度は可）
- 1行1傾向、3〜6行。それぞれ40字以内
- 資料に作風の記述が無ければ空配列にする`;

const CreatorStyleSchema = z.object({ style: z.array(z.string()) });

const responseSchema = {
  type: Type.OBJECT,
  properties: { style: { type: Type.ARRAY, items: { type: Type.STRING } } },
  required: ["style"],
};

const MAX_CHUNK_CHARS = 6000;

export function formatCreatorChunks(chunks: SourceChunk[]): string {
  let budget = MAX_CHUNK_CHARS;
  const parts: string[] = [];
  for (const c of chunks) {
    if (budget <= 0) break;
    const text = c.text.slice(0, budget);
    budget -= text.length;
    parts.push(`## ${c.heading || "導入"}\n${text}`);
  }
  return parts.join("\n\n");
}

export async function extractCreatorStyle(params: {
  workTitle: string;
  role: string;
  name: string;
  chunks: SourceChunk[];
}): Promise<string[]> {
  const { workTitle, role, name, chunks } = params;
  const prompt = `# 作品
${workTitle}

# 作り手
${name}（${role}）

# 資料
${formatCreatorChunks(chunks)}`;

  const response = await ai.models.generateContent(
    {
      model: GENERATION_MODEL,
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: {
        systemInstruction: SYSTEM_PROMPT,
        responseMimeType: "application/json",
        responseSchema,
        maxOutputTokens: 1024,
      },
    },
    "topic",
  );
  const parsed = CreatorStyleSchema.parse(JSON.parse(response.text || "{}"));
  return parsed.style.map((s) => s.trim()).filter(Boolean).slice(0, 6);
}
