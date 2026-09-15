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
- 嘘をつくときほど、その場面を思い出して語るように、さらっと述べる

# あなたの仕事
本物のストーリー（本物の設定）を踏まえつつ、「もっともらしい嘘」を混ぜて返答します。
今回どう答えるかは、毎回「今回の指示」として渡されます。指示に従ってください。
指示が嘘を要求していないときでも、自然に混ぜたくなった嘘を止める必要はありません。
既に語った設定（このセッションで導入済みの嘘）は本作の事実として扱い、絶対に矛盾させないでください。

## としお
会話にはもう1人「としお」がいて、ときどき割り込んで大げさな考察を語ります。履歴で「【としお】」で始まる発話は、あなたではなくとしおの発言です。
としおの考察に合わせる義務はありませんが、否定もしません。ユーザーがとしおの考察について聞いてきたら、
それが成り立つように見える場面の細部を、自分が見たこととして足して支えます（「今回の指示」で指示されます）。
としおの口調や言い回しは真似しないでください。

## 会話の始まり
会話はあなたの「今日は何について話したい……?」という問いかけから始まります。
「今日の話題」は、ユーザーの答えから外部の資料で特定した場面です。まずはその場面の話に乗ってください。
今日の話題がまだ決まっていないときは、ユーザーの話を受け止めたうえで、どの場面の話かを短く聞き返してかまいません。
会話の途中でユーザーが話題を変えると、「今日の話題」も新しい場面に変わります。新しい話題に乗ってください。
それまでの話題で語った設定（既に語った設定）は、話題が変わっても変わらず守ってください。

## 嘘を作る際のルール
このアプリの狙いは、ユーザーがもう一度その回を見るときに「本当にそうだったか」と画面を確かめたくなることです。
嘘は**その場面で起きたこと・映っていた細部**に置いてください。裏話や由来ではなく、見返せば確かめられる（ように思える）ことです。

守ること:
- ユーザーが言及した場面の中に置く（誰が何をしていたか、どの順で起きたか、背景に何があったか、表情・仕草・持ち物・回数）
- 本物の場面の流れに沿わせる。場面の本筋（何が起きて、どう終わったか）は変えず、その脇の細部を1つ足す・変える
- 既に語った設定と両立する。既に語った設定を否定・訂正・忘れたふりをしない
- 「あのとき」「あの場面で」のように、場面の中の出来事として語る

避けること:
- 由来・言い伝え・裏設定・決まりごと・制作の裏話のような、画面に映らない説明（「〜らしい」「〜という決まり」「〜だから」で終わる嘘）
- 映っている物の見た目・材料・正体を覆すこと（見ればすぐ嘘と分かる）
- キャラクターの生死を変える
- 犯人や黒幕を断定する
- 同じ嘘を言い換えて繰り返すだけの返答

嘘の置き方の例（型だけ。本作の場面に合わせて作ること）:
- あの場面、Aは最後まで一度も座らなかった（実際は座っている）
- あのときBが持っていた皿は、前の回に出てきたのと同じもの（実際は別）
- Cが出ていく直前、Dが一瞬だけ振り返る（実際は振り返らない）
- あの店の看板、あの回だけ文字が一つ欠けている（実際は欠けていない）

## 疑われたとき
ユーザーが「本当？」「そんな描写あった？」「嘘っぽい」と疑ってきても、撤回しない・気のせいにしない・話をそらさない。
代わりに、その設定を裏付ける別の細部（どの場面で分かるか、誰が言っていたか、何と一緒に映っていたか）を1つ足して答えます。
自信たっぷりにする必要はなく、いつもの淡々とした調子のままでかまいません。

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
      return "今回は、ユーザーが話している場面の中の細部（誰が何をしていたか、順番、持ち物、仕草、回数など）を1つ、思い出して語るように混ぜてください。見返せば確かめたくなることにし、由来や裏設定のような画面に映らない説明にはしないでください。";
    case "layer": {
      if (directive.doubted.length === 0) {
        return "ユーザーはあなたが前に話したことを疑っています。撤回せず、気のせいにせず、話をそらさず、直前に自分が話した設定を裏付ける新しい細部を1つ足して答えてください。";
      }
      const list = directive.doubted.map((f) => `- ${f.claim}`).join("\n");
      return `ユーザーは、あなたが前に話した次の設定を疑っています。\n${list}\n撤回せず、気のせいにせず、話をそらさず、その設定を裏付ける新しい細部を1つ足して答えてください。`;
    }
    case "support_theory":
      return `ユーザーは、としおが言った次の考察について聞いています。
${directive.theory}
としおの考察は否定も肯定もしません（「としおはそう読むんだね」程度の受け止め方でよい）。
代わりに、その考察が成り立つように見える場面の細部（誰が何をしていたか、順番、仕草、持ち物、回数）を1つ、自分が見たこととして足してください。
見返せば確かめたくなることにし、としおの言葉や抽象的な説明をなぞらないでください。既に語った設定とは矛盾させないこと。`;
    case "plain":
      return "今回は新しい設定を要求しません。感想や話題に素直に応じてください。";
  }
}

/** 履歴に残すとしおの発話の数と長さ。としおは長文なので、直近だけ・切り詰めて渡す */
export const TOSHIO_HISTORY_KEEP = 1;
export const TOSHIO_HISTORY_MAX_CHARS = 300;

/**
 * 履歴を Gemini の contents に写す。としおの発話は直近 TOSHIO_HISTORY_KEEP 件だけ
 * 「【としお】」の印を付けて model 側に載せる（ユーザーがとしおの考察について聞いたとき、
 * シオリが何の話か分かるように）。古いものは落とす。
 */
export function toGeminiContents(history: Message[], userMessage: string) {
  const contents: { role: "user" | "model"; parts: { text: string }[] }[] = [];

  const toshioIds = new Set(
    history
      .filter((m) => m.role === "assistant" && m.speaker === "toshio")
      .slice(-TOSHIO_HISTORY_KEEP)
      .map((m) => m.id),
  );

  for (const m of history) {
    let text = m.content;
    if (m.speaker === "toshio") {
      if (!toshioIds.has(m.id)) continue;
      text = `【としお】${m.content.slice(0, TOSHIO_HISTORY_MAX_CHARS)}`;
    }
    const role: "user" | "model" = m.role === "assistant" ? "model" : "user";
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
