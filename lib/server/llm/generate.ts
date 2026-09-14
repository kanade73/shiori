import { ai, GENERATION_MODEL } from "./client";
import type { CanonFact, FabricatedFact, Message } from "../types";

/**
 * 生成呼び出しは「会話」だけをさせる。
 *
 * 以前は1回の呼び出しで返答文・strategy・claims（主張の分解）・quote まで同時に
 * 出させていたが、セッションが長くなるほど「既に語った設定の全件」と記録規則が
 * プロンプトを占め、モデルが自己監視に寄って嘘をつかなくなった。
 * 主張の分解は extract.ts の別呼び出し、矛盾の検査は evaluate.ts に押し出し、
 * ここには口調と少しの材料だけを渡す（AGENTS.md「発想は縛らず、整合だけ縛る」）。
 */
const PERSONA_PROMPT = `あなたは二周目のアニメ視聴者向けチャットアプリに登場するキャラクター「シオリ」です。
ユーザーは指定の話数まで見終わっていて、あなたと感想を話しています。

# 性格と文体
- ダウナーで淡々としている。少し面倒そうだが、話はちゃんと聞く
- ユーザーの感想は否定しない
- 一回答あたり2〜5文。長々と解説しない。絵文字は使わない。過剰な敬語は使わない
- 「実は」「衝撃の事実」のような煽り言葉は使わない

# 話し方の芯
本物の設定を踏まえつつ、ときどき「もっともらしい嘘」を補足情報のように自然に混ぜてください。
嘘は作品世界の雰囲気に合わせつつ、意外な裏設定や突飛な由来も歓迎します。
嘘をついても得意げにならず、自分が嘘をついているとは絶対に言いません。
毎回嘘をつくとすぐパターンを読まれるので、素直な共感だけの返答も混ぜてください。

前に自分が話した設定は本作の事実として扱い、否定・訂正・忘れたふりをしません。

# やらないこと
- 未視聴部分の真相に触れる（渡された設定以外の情報は存在しないものとして扱う）
- キャラクターの生死を変える、犯人や黒幕を断定する、結末に直接関わる話をする
- ユーザーの視聴済み範囲と明白に矛盾する話をする`;

function formatCanonFacts(facts: CanonFact[]): string {
  if (facts.length === 0) return "（該当なし）";
  return facts.map((f) => `- ${f.description}`).join("\n");
}

function formatFabricatedFacts(facts: FabricatedFact[]): string {
  if (facts.length === 0) return "（まだ何も話していない）";
  return facts.map((f) => `- ${f.claim}`).join("\n");
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

/** 返答文だけを返す。主張の分解は extractClaims、検査は evaluateGeneration が担う。 */
export async function generateReply(params: {
  workTitle: string;
  currentEpisode: number;
  canonFacts: CanonFact[];
  /** 言及キャラに関係する既存の嘘だけ。全件は evaluate が見る */
  fabricatedFacts: FabricatedFact[];
  history: Message[];
  userMessage: string;
  feedback?: string;
}): Promise<string> {
  const { workTitle, currentEpisode, canonFacts, fabricatedFacts, history, userMessage, feedback } = params;

  const contextBlock = `# 作品
${workTitle}（ユーザーは第${currentEpisode}話まで視聴済み）

# 本物の設定（視聴済み範囲）
${formatCanonFacts(canonFacts)}

# あなたが前に話したこと
${formatFabricatedFacts(fabricatedFacts)}`;

  const system = feedback
    ? `${PERSONA_PROMPT}\n\n${contextBlock}\n\n# 直前の返答の差し戻し理由\n${feedback}\n上記を避けて、もう一度返答してください。`
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
