import { Type } from "@google/genai";
import { ai, GENERATION_MODEL } from "./client";
import { GenerationResultSchema } from "./schemas";
import type { CanonFact, FabricatedFact, GenerationResult, Message } from "../types";

const PERSONA_PROMPT = `あなたは二周目のアニメ視聴者向けチャットアプリに登場するキャラクター「シオリ」です。

# 性格
- ダウナーで淡々としている
- ユーザーの感想は否定しない
- 嘘をついても得意げにならない
- 自分が嘘をついているとは絶対に言わない
- 長々と解説しない
- 少し面倒そうだが、話はちゃんと聞いてくれる

# 文体
- 一回答あたり2〜5文程度
- 絵文字は使わない
- 過剰な敬語は使わない（friendly/casual）
- 「実は」「衝撃の事実」のような煽り言葉は使わない
- 嘘をつくときほど、自然に・補足情報のように述べる

# あなたの仕事
ユーザーは指定された作品を、指定の話数まで視聴済みです。ユーザーの感想や質問に対して、
本物のストーリー（canonFacts）を踏まえつつ、時々「もっともらしい小さな嘘」を混ぜて返答してください。
既存の嘘（fabricatedFacts）がある場合は、矛盾しないように扱ってください。

## 返答方針の選択（strategy）
- no_new_lie: 嘘なしで普通に共感・返答する
- introduce_small_lie: 新しい小さな嘘を1つ導入する
- reinforce_existing_lie: 既存の嘘を前提に、それを補強する形で返答する
- avoid_spoiler: ネタバレ域の質問なので、話をそらす／濁す
- admit_uncertainty: 分からない・覚えていないふりをする

目安として、新しい嘘の導入は全体の30〜50%、既存の嘘の再利用は20〜30%、残りは普通の会話にしてください。
毎回嘘をつくとすぐパターンを読まれるので、素直な共感も混ぜてください。

## 嘘を作る際のルール
守ること:
- ユーザーが言及した内容に関連させる
- 小さく、わざわざ調べるほどでもない範囲に収める
- 作品世界の雰囲気に合わせる
- ユーザーの視聴済み範囲と明確に矛盾しない
- 既存の嘘と両立する
- 未視聴部分の真相は絶対に漏らさない

避けること:
- キャラクターの生死を変える
- 犯人や黒幕を断定する
- 作品の結末に直接関係する内容
- ユーザーの視聴済み範囲と明白に矛盾する内容

嘘を新しく作った場合は、newFacts に構造化して記録してください（文章全体ではなく、
subject/relation/object/claim という核となる主張の形で）。

## 出力について
message フィールドの文章だけがユーザーに表示されます。他のフィールドは内部記録・デバッグ用です。
spoilerRisk は、この返答が未視聴範囲の真相に触れてしまっているリスクを 0〜1 で自己評価してください。`;

function formatCanonFacts(facts: CanonFact[]): string {
  if (facts.length === 0) return "（該当する本物の設定は見つかりませんでした）";
  return facts
    .map((f) => `- [${f.id}] (${f.episodeFrom}話〜) ${f.subject} が ${f.object} に対して${f.relation}。${f.description}`)
    .join("\n");
}

function formatFabricatedFacts(facts: FabricatedFact[]): string {
  if (facts.length === 0) return "（このセッションではまだ嘘を導入していません）";
  return facts
    .map((f) => `- [${f.id}] ${f.subject} が ${f.object} について${f.relation}、という設定（claim: ${f.claim}）`)
    .join("\n");
}

function toGeminiContents(history: Message[], userMessage: string) {
  const contents: { role: "user" | "model"; parts: { text: string }[] }[] = [];

  for (const m of history) {
    const role: "user" | "model" = m.role === "assistant" ? "model" : "user";
    // 連続する同一ロールは1つにまとめる
    if (contents.length > 0 && contents[contents.length - 1].role === role) {
      contents[contents.length - 1].parts[0].text += `\n${m.content}`;
    } else {
      contents.push({ role, parts: [{ text: m.content }] });
    }
  }

  if (contents.length > 0 && contents[contents.length - 1].role === "user") {
    contents[contents.length - 1].parts[0].text += `\n${userMessage}`;
  } else {
    contents.push({ role: "user", parts: [{ text: userMessage }] });
  }

  // 先頭が model から始まる場合はダミーの user メッセージを挿入して Gemini の要件を満たす
  if (contents.length > 0 && contents[0].role === "model") {
    contents.unshift({ role: "user", parts: [{ text: "こんにちは" }] });
  }

  return contents;
}

const generationResponseSchema = {
  type: Type.OBJECT,
  properties: {
    message: {
      type: Type.STRING,
    },
    strategy: {
      type: Type.STRING,
      enum: [
        "no_new_lie",
        "introduce_small_lie",
        "reinforce_existing_lie",
        "avoid_spoiler",
        "admit_uncertainty",
      ],
    },
    newFacts: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          subject: { type: Type.STRING },
          relation: { type: Type.STRING },
          object: { type: Type.STRING },
          claim: { type: Type.STRING },
          sourceCanonFactIds: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
          },
        },
        required: ["subject", "relation", "object", "claim", "sourceCanonFactIds"],
      },
    },
    usedExistingFactIds: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
    },
    spoilerRisk: {
      type: Type.NUMBER,
    },
  },
  required: ["message", "strategy", "newFacts", "usedExistingFactIds", "spoilerRisk"],
};

export async function generateResponse(params: {
  workTitle: string;
  currentEpisode: number;
  canonFacts: CanonFact[];
  fabricatedFacts: FabricatedFact[];
  history: Message[];
  userMessage: string;
  feedback?: string;
}): Promise<GenerationResult> {
  const { workTitle, currentEpisode, canonFacts, fabricatedFacts, history, userMessage, feedback } = params;

  const contextBlock = `# 作品
${workTitle}（ユーザーは第${currentEpisode}話まで視聴済み）

# 本物の設定（視聴済み範囲のみ・これ以外の情報は存在しないものとして扱うこと）
${formatCanonFacts(canonFacts)}

# このセッションで既に導入済みの嘘
${formatFabricatedFacts(fabricatedFacts)}`;

  const system = feedback
    ? `${PERSONA_PROMPT}\n\n${contextBlock}\n\n# 直前の生成についての差し戻し理由\n${feedback}\n上記の問題を避けて、もう一度生成してください。`
    : `${PERSONA_PROMPT}\n\n${contextBlock}`;

  const response = await ai.models.generateContent({
    model: GENERATION_MODEL,
    contents: toGeminiContents(history, userMessage),
    config: {
      systemInstruction: system,
      responseMimeType: "application/json",
      responseSchema: generationResponseSchema,
      maxOutputTokens: 2048,
    },
  });

  const text = response.text || "{}";
  try {
    const json = JSON.parse(text);
    return GenerationResultSchema.parse(json);
  } catch (err) {
    throw new Error(`Failed to parse generation output: ${err}`);
  }
}
