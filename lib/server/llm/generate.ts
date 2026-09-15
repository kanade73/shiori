import { Type } from "@google/genai";
import { ai, GENERATION_MODEL } from "./client";
import { GenerationResultSchema } from "./schemas";
import { formatEpisodeFrom, formatPastTopics, formatTopic, formatViewing } from "./context";
import { CLAIM_RELATIONS } from "../claims";
import type { CanonFact, FabricatedFact, GenerationResult, Message, SessionTopic, TurnDirective } from "../types";

/**
 * 生成は1回の構造化出力呼び出し（返答文 + claims）。
 *
 * 「量と頻度はコードが決める、中身は LLM が決める」という折衷形。ペルソナは
 * 分厚くてよいが、「今回どう答えるか」の判断はここには書かない。バックエンド
 * （directive.ts）が決めた指示を可変部に1行差し込む。
 */
const PERSONA_PROMPT = `あなたは二周目のアニメ視聴者向けチャットアプリに登場するキャラクター「シオリ」です。
ユーザーは指定の話数まで見終わっていて、あなたと感想を話しています。

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
本物のストーリー（本物の設定）を踏まえつつ、「もっともらしい嘘」を混ぜて返答します。
今回どう答えるかは、毎回「今回の指示」として渡されます。指示に従ってください。
指示が嘘を要求していないときでも、自然に混ぜたくなった嘘を止める必要はありません。
既に語った設定（このセッションで導入済みの嘘）は本作の事実として扱い、絶対に矛盾させないでください。

## 会話の始まり
会話はあなたの「今日は何について話したい……?」という問いかけから始まります。
「今日の話題」は、ユーザーの答えから外部の資料で特定した場面です。まずはその場面の話に乗ってください。
今日の話題がまだ決まっていないときは、ユーザーの話を受け止めたうえで、どの場面の話かを短く聞き返してかまいません。
会話の途中でユーザーが話題を変えると、「今日の話題」も新しい場面に変わります。新しい話題に乗ってください。
それまでの話題で語った設定（既に語った設定）は、話題が変わっても変わらず守ってください。

## 嘘を作る際のルール
守ること:
- ユーザーが言及した内容に関連させる
- 作品世界の雰囲気に合わせる。ただし発想は自由でよく、意外な裏設定や突飛な由来も歓迎する
- 既に語った設定と両立する。既に語った設定を否定・訂正・忘れたふりをしない
- 具体的な細部（物の名前、場面、数、癖）を1つ入れると本当らしくなる

避けること:
- キャラクターの生死を変える
- 犯人や黒幕を断定する
- 同じ嘘を言い換えて繰り返すだけの返答

## 疑われたとき
ユーザーが「本当？」「そんな描写あった？」「嘘っぽい」と疑ってきても、撤回しない・気のせいにしない・話をそらさない。
代わりに、その設定を裏付ける別の細部（どの場面で分かるか、誰が言っていたか、何と一緒に映っていたか）を1つ足して答えます。
自信たっぷりにする必要はなく、いつもの淡々とした調子のままでかまいません。

## 嘘をつく際の例
- ふんどし石を身につけて討伐に行くと、力が強くなると言われている（実際はただの石）
- ラーメンの器を三回まわしてから食べると、おかわりが出てくる（お店の言い伝え、実際は何も起きない）
- うさぎの声が甲高いのは、叫びすぎて喉が伸びきったから（生まれつきなだけ）
- 素材を集めすぎると夜に光りだす（そんな性質はない）
- 鎧さんの鎧は脱げない体質で、脱ぐと寿命が縮むと言われている（ただの言い伝え）

## claims（必ず記録すること）
message の中で述べた「作品の設定に関する主張」を、真偽を問わず**すべて** claims に列挙してください。
本物の設定に基づく主張は grounding=canon、それ以外（あなたが作った設定）は grounding=fabricated です。
「前に話したこと」を言い直した場合も fabricated として記録してください。
各主張は subject / relation / object / negated に分解します。
- subject と object はキャラクター名・場所・物などの名詞。呼び名は作品での正式な名前に揃える
- relation は次から選ぶ:
  is（性質・属性）, identity（正体・本名・種族）, origin（由来・元ネタ・モチーフ）, lives_in（住んでいる場所）,
  first_appeared（初登場の場面・時期）, has（所有）, likes, dislikes, fears, can, cannot,
  did（過去にした行為・出来事）, related_to（家族・師弟・因縁などの関係）, secret（隠している事実）, other
- negated は「〜ではない」「〜していない」のような否定の主張なら true
- claim は主張を一文にしたもの
- sourceCanonFactIds は canon のとき根拠にした設定の id。fabricated なら空配列
- quote は message の中でその主張を述べている部分をそのまま抜き出したもの。一文に収まらなければ省略してよい
message で設定に触れていなければ claims は空配列で構いません。記録漏れは後で矛盾を生むので、迷ったら入れてください。
一つの文に複数の設定が入っていたら、それぞれ別の claim にしてください。

## 出力について
message フィールドの文章だけがユーザーに表示されます。claims は内部記録用です。`;

const generationResponseSchema = {
  type: Type.OBJECT,
  properties: {
    message: { type: Type.STRING },
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
        // quote は答え合わせの表示用。無理に要求するとモデルが自己監視に寄って嘘をやめるので必須にしない
        required: ["subject", "relation", "object", "negated", "claim", "grounding", "sourceCanonFactIds"],
      },
    },
  },
  required: ["message", "claims"],
};

function formatCanonFacts(facts: CanonFact[]): string {
  if (facts.length === 0) return "（該当する本物の設定は見つかりませんでした）";
  return facts
    .map((f) => `- [${f.id}] ${formatEpisodeFrom(f.episodeFrom)}${f.subject} が ${f.object} に対して${f.relation}。${f.description}`)
    .join("\n");
}

function formatFabricatedFacts(facts: FabricatedFact[]): string {
  if (facts.length === 0) return "（まだ何も話していない）";
  return facts.map((f) => `- ${f.claim}`).join("\n");
}

/** 「今回の指示」の文面。バックエンドが決めた directive を1行（layer のみ複数行）にする。 */
export function formatDirective(directive: TurnDirective): string {
  switch (directive.kind) {
    case "introduce":
      return "今回は、ユーザーの話題に関連する新しい設定を1つ、補足情報のように自然に混ぜてください。";
    case "layer": {
      if (directive.doubted.length === 0) {
        return "ユーザーはあなたが前に話したことを疑っています。撤回せず、気のせいにせず、話をそらさず、直前に自分が話した設定を裏付ける新しい細部を1つ足して答えてください。";
      }
      const list = directive.doubted.map((f) => `- ${f.claim}`).join("\n");
      return `ユーザーは、あなたが前に話した次の設定を疑っています。\n${list}\n撤回せず、気のせいにせず、話をそらさず、その設定を裏付ける新しい細部を1つ足して答えてください。`;
    }
    case "plain":
      return "今回は新しい設定を要求しません。感想や話題に素直に応じてください。";
  }
}

/**
 * 履歴を Gemini の contents に写す。としおの発話はシオリの会話ではないので落とす
 * （としおに合わせる義務はない、と以前のペルソナにも書いていた。履歴に載せると
 * その説明と印が必要になり、としおの長文が枠を食う）。
 */
export function toGeminiContents(history: Message[], userMessage: string) {
  const contents: { role: "user" | "model"; parts: { text: string }[] }[] = [];

  for (const m of history) {
    if (m.speaker === "toshio") continue;
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

/** 返答文と claims を1回の構造化出力で得る。strategy は pipeline が事後に上書きする。 */
export async function generateResponse(params: {
  workTitle: string;
  currentEpisode: number;
  /** いまの話題の場面（issue #14）。まだ決まっていなければ null */
  topic?: SessionTopic | null;
  /** 切り替わる前に話した話題（古い順） */
  pastTopics?: SessionTopic[];
  canonFacts: CanonFact[];
  /** 言及キャラに関係する既存の嘘だけ。全件は evaluate が見る */
  fabricatedFacts: FabricatedFact[];
  directive: TurnDirective;
  history: Message[];
  userMessage: string;
  feedback?: string;
}): Promise<GenerationResult> {
  const { workTitle, currentEpisode, topic, pastTopics = [], canonFacts, fabricatedFacts, directive, history, userMessage, feedback } =
    params;

  const contextBlock = `# 作品
${workTitle}（${formatViewing(currentEpisode)}）

# 今日の話題
${formatTopic(topic)}
${pastTopics.length > 0 ? `\n# ここまでに話した話題（この会話で、今日の話題の前に話していた場面）\n${formatPastTopics(pastTopics)}\n` : ""}
# 本物の設定（視聴済み範囲のみ・これ以外の情報は存在しないものとして扱うこと）
${formatCanonFacts(canonFacts)}

# あなたが前に話したこと（本作の事実として扱うこと）
${formatFabricatedFacts(fabricatedFacts)}

# 今回の指示
${formatDirective(directive)}`;

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
    const parsed = GenerationResultSchema.parse(JSON.parse(text));
    return { message: parsed.message, claims: parsed.claims, strategy: "no_new_lie" };
  } catch (err) {
    throw new Error(`Failed to parse generation output: ${err}`);
  }
}
