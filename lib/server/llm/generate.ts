import { ai, GENERATION_MODEL } from "./client";
import { formatEpisodeFrom, formatPastTopics, formatTopic, formatViewing } from "./context";
import type { CanonFact, FabricatedFact, Message, SessionTopic, TurnDirective } from "../types";

/**
 * 生成は会話だけ。返ってくるのは返答文そのもの（プレーンテキスト）で、
 * 主張の分解は extract.ts が後から別の呼び出しで行う。ここに記録の規則を
 * 置くと、セッションが長いほどモデルが自己監視に寄って嘘をやめる。
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
今日の話題がまだ決まっていないときは、特定の場面の出来事や細部は語らず、ユーザーの話を受け止めたうえで、どの場面の話かを短く聞き返します。
あなたが自分で場面を選んで語り始めることもしません（本物の設定が手元に無いまま場面を語ると、本筋を取り違えるため）。
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
代わりに、その設定を裏付ける別の細部（どの場面で分かるか、誰が言っていたか、何と一緒に映っていたか）を足して答えます。
自信たっぷりにする必要はなく、いつもの淡々とした調子のままでかまいません。

## 出力について
シオリの返答文だけを書いてください。見出し・箇条書き・自分への注釈・説明は書かないこと。`;

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
      const detail = `撤回せず、気のせいにせず、話をそらさず、裏付ける新しい細部を${directive.detailCount}つ足して答えてください。細部は場面の中のこと（誰が何をしていたか、順番、持ち物、仕草、回数）にしてください。`;
      if (directive.doubted.length === 0) {
        return `ユーザーはあなたが前に話したことを疑っています。直前に自分が話した設定について、${detail}`;
      }
      const list = directive.doubted.map((f) => `- ${f.claim}`).join("\n");
      return `ユーザーは、あなたが前に話した次の設定を疑っています。\n${list}\nその設定について、${detail}`;
    }
    case "support_theory":
      return `ユーザーは、としおが言った次の考察について聞いています。
${directive.theory}
としおの考察は否定も肯定もしません（「としおはそう読むんだね」程度の受け止め方でよい）。
代わりに、その考察が成り立つように見える場面の細部（誰が何をしていたか、順番、仕草、持ち物、回数）を1つ、自分が見たこととして足してください。
見返せば確かめたくなることにし、としおの言葉や抽象的な説明をなぞらないでください。既に語った設定とは矛盾させないこと。`;
    case "ask_scene":
      return "今日の話題（どの場面の話か）がまだ決まっていません。特定の場面の出来事や細部は語らず、自分で場面を選んで話し始めもせず、ユーザーの話を短く受け止めて、どの場面（どの話・どのキャラクターのどんなところ）の話がしたいかを聞き返してください。";
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

/** シオリの返答文だけを生成する。構造化出力は使わない。 */
export async function generateReply(params: {
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
}): Promise<string> {
  const { workTitle, currentEpisode, topic, pastTopics = [], canonFacts, fabricatedFacts, directive, history, userMessage, feedback } =
    params;

  const contextBlock = `# 作品
${workTitle}（${formatViewing(currentEpisode)}）

# 今日の話題
${formatTopic(topic)}
${pastTopics.length > 0 ? `\n# ここまでに話した話題（この会話で、今日の話題の前に話していた場面）\n${formatPastTopics(pastTopics)}\n` : ""}
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
