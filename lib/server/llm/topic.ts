import { Type } from "@google/genai";
import { ai, GENERATION_MODEL } from "./client";
import { TopicExtractionSchema, type TopicExtraction } from "./schemas";
import { CLAIM_RELATIONS } from "../claims";
import type { SourceChunk } from "../types";

/**
 * issue #14: 会話の最初の「今日は何について話したい?」への返答から、ユーザーが話したい
 * 場面を外部の資料（sources.ts が選んだ段落）の中で特定し、その場面の事実を抜き出す。
 * ここで抜き出した事実が、以後の会話でシオリが語る「本物の設定」の中心になる。
 *
 * シオリの発想は縛らない方針だが、ここは事実の側なので資料に書かれていることだけに縛る
 * （事実が間違っていると嘘が成立しない）。
 */

const MAX_FACTS = 8;

const SYSTEM_PROMPT = `あなたはアニメ作品についての資料係です。
ユーザーは、ある作品について「今日は何について話したい?」と聞かれて答えたか、会話の途中で別の話題に移ろうとしています。
下の資料（外部の知識源から、答えに関係しそうな段落を選んだもの）から、ユーザーが話したい場面・エピソード・人物を特定し、
その話題について資料から読み取れる事実を抜き出してください。

# 守ること
- 資料に書かれていることだけを使う。資料に無いことを補ったり、推測で埋めたりしない
- 話題が特定できなければ found=false にする（挨拶だけ、作品と関係ない話、資料に該当する段落が無い など）
- 資料に場面（エピソード）そのものを書いた段落があれば、それを話題の場面にする。用語や人物の段落は、その場面を補う説明にだけ使う
- 人物そのものについて話したいなら、その人物を話題にする
- title はその場面の呼び名（資料の段落の見出し。「〇〇編」など）。人物の話ならその人物の名前
- summary は、その場面で何が起きるかを資料に沿って2文以内で
- chunkIds は、話題の特定に使った段落の id
- facts はその話題についての事実を最大${MAX_FACTS}件。1件1主張で、subject / relation / object に分解する
  - ユーザーが話したい場面の時点で分かることに限る。同じ題材の続編・後日談（2回目以降の挑戦、再登場、後の段階への昇格など）は、それが話題の場面そのものでない限り facts にも summary にも入れない
  - relation は次から選ぶ: is（性質・属性）, identity（正体・本名・種族）, origin（由来・元ネタ・モチーフ）, lives_in（住んでいる場所）,
    first_appeared（初登場の場面・時期）, has（所有）, likes, dislikes, fears, can, cannot, did（過去にした行為・出来事）,
    related_to（家族・師弟・因縁などの関係）, secret（隠している事実）, other
  - subject は「その事実の主体」。集団（「ちいかわ達」「メンバー」）でまとめず、資料で名前が分かる人物ごとに、その人物を主語にした事実を別々に出す
    （「ハチワレがカードダスでカブト王を引き当てた」なら subject は カブトムシ ではなく ハチワレ。集団の行動は、名前の分かる人物それぞれの事実にする）
  - 同じものを指す呼び名（「黒い流れ星」と「黒い星」、「〇〇」と「〇〇のメンバー」）は、資料で最初に出る正式な呼び名に揃える
  - description はその事実を自分の言葉で1文にしたもの（資料の文をそのまま写さない）
  - chunkId はその事実が書かれていた段落の id
- 話題の場面より後で明かされること（後の回での再挑戦の結果、正体の判明、結末など）は facts に入れない。ユーザーはそこまで見ていないかもしれない
- 人物の話なら、その人物の基本的な設定と、ユーザーが触れた場面に関係することを中心にする`;

function formatChunks(chunks: SourceChunk[]): string {
  return chunks
    .map((c) => {
      const where = [c.heading, c.label].filter(Boolean).join(" / ");
      return `[${c.id}]（${c.sourceTitle}${where ? ` / ${where}` : ""}）\n${c.text}`;
    })
    .join("\n\n");
}

const topicResponseSchema = {
  type: Type.OBJECT,
  properties: {
    found: { type: Type.BOOLEAN },
    title: { type: Type.STRING },
    summary: { type: Type.STRING },
    chunkIds: { type: Type.ARRAY, items: { type: Type.STRING } },
    facts: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          subject: { type: Type.STRING },
          relation: { type: Type.STRING, enum: [...CLAIM_RELATIONS] },
          object: { type: Type.STRING },
          description: { type: Type.STRING },
          chunkId: { type: Type.STRING },
        },
        required: ["subject", "relation", "object", "description", "chunkId"],
      },
    },
  },
  required: ["found", "title", "summary", "chunkIds", "facts"],
};

export async function extractTopic(params: {
  workTitle: string;
  userMessage: string;
  /** 話題の切り替えで、判定役が発話から組み直した検索語。ユーザーの発話が指示語だけのときの手がかり */
  query?: string;
  chunks: SourceChunk[];
}): Promise<TopicExtraction> {
  const { workTitle, userMessage, query, chunks } = params;

  const prompt = `# 作品
${workTitle}

# ユーザーの答え
${userMessage}
${query ? `\n# ユーザーが話したい話題（会話の流れから補ったもの）\n${query}\n` : ""}
# 資料
${formatChunks(chunks)}`;

  const response = await ai.models.generateContent({
    model: GENERATION_MODEL,
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    config: {
      systemInstruction: SYSTEM_PROMPT,
      responseMimeType: "application/json",
      responseSchema: topicResponseSchema,
      maxOutputTokens: 2048,
    },
  });

  const parsed = TopicExtractionSchema.parse(JSON.parse(response.text || "{}"));
  // 資料に無い段落を根拠にした事実は捨てる（資料の外から持ち込んだものかもしれない）
  const known = new Set(chunks.map((c) => c.id));
  return {
    ...parsed,
    chunkIds: parsed.chunkIds.filter((id) => known.has(id)),
    facts: parsed.facts.filter((f) => known.has(f.chunkId)).slice(0, MAX_FACTS),
  };
}
