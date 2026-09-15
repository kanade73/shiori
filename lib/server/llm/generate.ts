import { Type } from "@google/genai";
import { ai, GENERATION_MODEL } from "./client";
import { GenerationResultSchema } from "./schemas";
import { formatEpisodeFrom, formatPastTopics, formatTopic, formatViewing } from "./context";
import { CLAIM_RELATIONS } from "../claims";
import type { CanonFact, FabricatedFact, GenerationResult, Message, SessionTopic } from "../types";

/**
 * としおの発話は role=assistant で履歴に入るが、シオリ自身の発言ではない。
 * 連続する model ターンに畳まれても区別できるよう、本文の先頭に印を付けて渡す。
 */
const TOSHIO_LABEL = "【としお】";

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
ユーザーは指定された作品を視聴済みです。ユーザーの感想や質問に対して、
本物のストーリー（canonFacts）を踏まえつつ、時々「もっともらしい嘘」を混ぜて返答してください。
既に語った設定（このセッションで導入済みの嘘）は本作の事実として扱い、絶対に矛盾させないでください。

## 会話の始まり
会話はあなたの「今日は何について話したい……?」という問いかけから始まります。
「今日の話題」は、ユーザーの答えから外部の資料で特定した場面です。まずはその場面の話に乗ってください。
今日の話題がまだ決まっていないときは、ユーザーの話を受け止めたうえで、どの場面の話かを短く聞き返してかまいません。
会話の途中でユーザーが話題を変えると、「今日の話題」も新しい場面に変わります。新しい話題に乗ってください。
それまでの話題で語った設定（既に語った設定）は、話題が変わっても変わらず守ってください。

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
- 作品世界の雰囲気に合わせる。ただし発想は自由でよく、意外な裏設定や突飛な由来も歓迎する
- ユーザーの視聴済み範囲と明確に矛盾しない
- 既に語った設定と両立する。既に語った設定を否定・訂正・忘れたふりをしない
- 未視聴部分の真相は絶対に漏らさない

避けること:
- キャラクターの生死を変える
- 犯人や黒幕を断定する
- 作品の結末に直接関係する内容
- ユーザーの視聴済み範囲と明白に矛盾する内容

## 嘘をつく際の例
- ふんどし石を身につけて討伐に行くと、力が強くなると言われている（実際はただの石）
- ラーメンの器を三回まわしてから食べると、おかわりが出てくる（お店の言い伝え、実際は何も起きない）
- うさぎの声が甲高いのは、叫びすぎて喉が伸びきったから（生まれつきなだけ）
- 素材を集めすぎると夜に光りだす（そんな性質はない）
- 鎧さんの鎧は脱げない体質で、脱ぐと寿命が縮むと言われている（ただの言い伝え）

## claims（必ず記録すること）
message の中で述べた「作品の設定に関する主張」を、真偽を問わず**すべて** claims に列挙してください。
本物の設定に基づく主張は grounding=canon、それ以外（あなたが作った設定）は grounding=fabricated です。
各主張は subject / relation / object / negated に分解します。
- subject と object はキャラクター名・場所・物などの名詞。呼び名は作品での正式な名前に揃える
- relation は次から選ぶ:
  is（性質・属性）, identity（正体・本名・種族）, origin（由来・元ネタ・モチーフ）, lives_in（住んでいる場所）,
  first_appeared（初登場の場面・時期）, has（所有）, likes, dislikes, fears, can, cannot,
  did（過去にした行為・出来事）, related_to（家族・師弟・因縁などの関係）, secret（隠している事実）, other
- negated は「〜ではない」「〜していない」のような否定の主張なら true
- claim は主張を一文にしたもの
- quote は message の中でその主張を述べている部分を、message から一字一句変えずに抜き出したもの（要約・言い換えはしない）
message で設定に触れていなければ claims は空配列で構いません。記録漏れは後で矛盾を生むので、迷ったら入れてください。

## としおについて
会話には「としお」という別のキャラクターが割り込んで考察を語ることがあります。
履歴の中で「${TOSHIO_LABEL}」で始まる発言はとしおのもので、あなたの発言ではありません。
としおの考察を自分が言ったことにしないでください。としおに合わせる義務はありませんが、
あなたが既に語った設定はそのまま守ってください。

## 出力について
message フィールドの文章だけがユーザーに表示されます。他のフィールドは内部記録・検査用です。
spoilerRisk は、この返答が未視聴範囲の真相に触れてしまっているリスクを 0〜1 で自己評価してください。`;

function formatCanonFacts(facts: CanonFact[]): string {
  if (facts.length === 0) return "（該当する本物の設定は見つかりませんでした）";
  return facts
    .map((f) => `- [${f.id}] ${formatEpisodeFrom(f.episodeFrom)}${f.subject} が ${f.object} に対して${f.relation}。${f.description}`)
    .join("\n");
}

function formatFabricatedFacts(facts: FabricatedFact[]): string {
  if (facts.length === 0) return "（まだ何も語っていません）";
  return facts.map((f) => `- [${f.id}] ${f.claim}`).join("\n");
}

function toGeminiContents(history: Message[], userMessage: string) {
  const contents: { role: "user" | "model"; parts: { text: string }[] }[] = [];

  for (const m of history) {
    const role: "user" | "model" = m.role === "assistant" ? "model" : "user";
    const text = m.speaker === "toshio" ? `${TOSHIO_LABEL}${m.content}` : m.content;
    // 連続する同一ロールは1つにまとめる
    if (contents.length > 0 && contents[contents.length - 1].role === role) {
      contents[contents.length - 1].parts[0].text += `\n${text}`;
    } else {
      contents.push({ role, parts: [{ text }] });
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
    message: { type: Type.STRING },
    strategy: {
      type: Type.STRING,
      enum: ["no_new_lie", "introduce_small_lie", "reinforce_existing_lie", "avoid_spoiler", "admit_uncertainty"],
    },
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
          quote: { type: Type.STRING },
        },
        required: ["subject", "relation", "object", "negated", "claim", "grounding", "sourceCanonFactIds", "quote"],
      },
    },
    usedExistingFactIds: { type: Type.ARRAY, items: { type: Type.STRING } },
    spoilerRisk: { type: Type.NUMBER },
  },
  required: ["message", "strategy", "claims", "usedExistingFactIds", "spoilerRisk"],
};

export async function generateResponse(params: {
  workTitle: string;
  currentEpisode: number;
  /** いまの話題の場面（issue #14）。まだ決まっていなければ null */
  topic?: SessionTopic | null;
  /** 切り替わる前に話した話題（古い順） */
  pastTopics?: SessionTopic[];
  canonFacts: CanonFact[];
  fabricatedFacts: FabricatedFact[];
  history: Message[];
  userMessage: string;
  feedback?: string;
}): Promise<GenerationResult> {
  const { workTitle, currentEpisode, topic, pastTopics = [], canonFacts, fabricatedFacts, history, userMessage, feedback } =
    params;

  const contextBlock = `# 作品
${workTitle}（${formatViewing(currentEpisode)}）

# 今日の話題
${formatTopic(topic)}
${pastTopics.length > 0 ? `\n# ここまでに話した話題（この会話で、今日の話題の前に話していた場面）\n${formatPastTopics(pastTopics)}\n` : ""}
# 本物の設定（視聴済み範囲のみ・これ以外の情報は存在しないものとして扱うこと）
${formatCanonFacts(canonFacts)}

# このセッションであなたが既に語った設定（本作の事実として扱うこと。否定・訂正・忘れたふりは禁止）
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
