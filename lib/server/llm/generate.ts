import { ai, GENERATION_MODEL } from "./client";
import type { CanonFact, FabricatedFact, Message, TurnDirective } from "../types";

/**
 * 生成は会話だけ。返ってくるのは返答文そのもの（プレーンテキスト）で、
 * 主張の分解は extract.ts が後から別の呼び出しで行う。ここに claims の
 * 記録規則を置くと、セッションが長いほどモデルが自己監視に寄って嘘をやめる。
 *
 * 「量と頻度はコードが決める、中身は LLM が決める」。ペルソナは分厚くてよいが、
 * 「今回どう答えるか」の判断はここには書かない。バックエンド（directive.ts）が
 * 決めた指示を可変部に差し込む。
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
代わりに、その設定を裏付ける別の細部（どの場面で分かるか、誰が言っていたか、何と一緒に映っていたか）を足して答えます。
自信たっぷりにする必要はなく、いつもの淡々とした調子のままでかまいません。

## 出力について
シオリの返答文だけを書いてください。見出し・箇条書き・自分への注釈・説明は書かないこと。`;

function formatCanonFacts(facts: CanonFact[]): string {
  if (facts.length === 0) return "（該当なし）";
  return facts.map((f) => `- ${f.description}`).join("\n");
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
      const detail = `撤回せず、気のせいにせず、話をそらさず、裏付ける新しい細部を${directive.detailCount}つ足して答えてください。`;
      if (directive.doubted.length === 0) {
        return `ユーザーはあなたが前に話したことを疑っています。直前に自分が話した設定について、${detail}`;
      }
      const list = directive.doubted.map((f) => `- ${f.claim}`).join("\n");
      return `ユーザーは、あなたが前に話した次の設定を疑っています。\n${list}\nその設定について、${detail}`;
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

/** シオリの返答文だけを生成する。構造化出力は使わない。 */
export async function generateReply(params: {
  workTitle: string;
  currentEpisode: number;
  canonFacts: CanonFact[];
  /** 言及キャラに関係する既存の嘘だけ。全件は evaluate が見る */
  fabricatedFacts: FabricatedFact[];
  directive: TurnDirective;
  history: Message[];
  userMessage: string;
  feedback?: string;
}): Promise<string> {
  const { workTitle, currentEpisode, canonFacts, fabricatedFacts, directive, history, userMessage, feedback } = params;

  const contextBlock = `# 作品
${workTitle}（ユーザーは第${currentEpisode}話まで視聴済み）

# 本物の設定
${formatCanonFacts(canonFacts)}

# あなたが前に話したこと（本作の事実として扱うこと）
${formatFabricatedFacts(fabricatedFacts)}

# 今回の指示
${formatDirective(directive)}`;

  const system = feedback
    ? `${PERSONA_PROMPT}\n\n${contextBlock}\n\n# 直前の返答の差し戻し理由\n${feedback}\n上記の問題を避けて、もう一度返答してください。`
    : `${PERSONA_PROMPT}\n\n${contextBlock}`;

  const response = await ai.models.generateContent({
    model: GENERATION_MODEL,
    contents: toGeminiContents(history, userMessage),
    config: {
      systemInstruction: system,
      maxOutputTokens: 1024,
    },
  });

  const text = (response.text ?? "").trim();
  if (!text) throw new Error("Empty generation output");
  return text;
}
