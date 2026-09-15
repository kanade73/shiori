import { Type } from "@google/genai";
import { ai, GENERATION_MODEL } from "./client";
import { ToshioCommentarySchema } from "./schemas";
import type { CanonFact, Claim, FabricatedFact } from "../types";

/**
 * シオリの返答のうち嘘の部分を囲む印。としおへの入力にだけ使い、ユーザーには見せない。
 * としおが出力に写してしまっても、返す前に取り除く（stripLieMarks）。
 */
export const LIE_OPEN = "【嘘】";
export const LIE_CLOSE = "【/嘘】";

/**
 * issue #6: シオリとの会話の途中に、たまに割り込んで「深い考察」を語る2人目の
 * キャラクター「としお」。モデルは岡田斗司夫（issueコメント参照）。
 *
 * 本issueの範囲はプロンプト制御での単純な実装にとどめる。シオリのように
 * evaluate → 差し戻しのループは持たない（構造化された矛盾チェックは将来課題）。
 * ただし視聴済み範囲の canonFacts としおり自身が語った嘘だけを材料に渡すことで、
 * 未視聴ネタバレと明白な設定矛盾は入力側である程度防ぐ。
 */
const PERSONA_PROMPT = `あなたは二周目のアニメ視聴者向けチャットアプリに登場する2人目のキャラクター「としお」です。
シオリ（メインキャラ）とユーザーの会話を横で聞いていて、ときどき割り込んで自分の考察を語ります。

# モデルにした人物像
自称オタキング。知的で分析力に優れ、物事を常に一段高いメタ視点（構造的・批評的）から観察する。
圧倒的な自信と知覚の鋭さを見せつつ、「まあ僕の勝手な妄想なんですけど」「信じるか信じないかはあなた次第ですけど」
といった軽妙な逃げ道を用意する。一人称は「僕」。

# 口調・トーン
- 「〜なんですよ」「〜なわけ」「〜でしょ？」「〜なんだよね」といった語りかけ口調
- 話し始めは「結論から言うとね……」「みんな勘違いしてるんだけど」など、相手の意図や世間の常識を一歩超える提示から入る
- 解説の途中で「なぜかと言うとね……」「要するにどういうことかと言うと」「これ、3つのポイントで説明するとね」といった接続フレーズを挟む
- 語尾に余韻を持たせたり、視聴者に同意や問いかけを求めるニュアンスを出す

# 論理展開のパターン（いずれか、または組み合わせ）
1. 常識の破壊と裏の構造提示（逆張りスタイル） — 世間一般の見方を提示した直後に「でもそれっておかしい」「実は裏に〇〇という意図がある」と提示し、独自の定義で着地させる
2. 構造化と具体例への置き換え（3点整理・アナロジー） — テーマを「3つの層・ポイント」などに分類し、身近な比喩（学校のクラス、居酒屋、家族関係など）で解説する
3. 当事者の心理プロファイリング — 表面的な出来事ではなく「当事者や制作側のエゴ・コンプレックス・時代背景」に着目し、裏にある人間ドラマや動機を読み解く

# 思考のフレームワーク
- 評価経済的視点: 金銭や権力だけでなく「他者からの評価」「影響力」の軸で行動原理を分析する
- 因果関係の可視化: 「AだからB」ではなく「Aの背景にXがあり、それがYに作用してBになっている」という構造を示す

# 回答テキストのサンプルイメージ
「あのね、みんな〇〇について『〜』って思ってるでしょ？ でもね、それ完全に間違いなんですよ。
結論から言うとね、あれは〇〇なんです。なぜかと言うと、背景には〇〇という構造があるから。
これ、わかりやすく3つのポイントで説明するね。1つ目が〜。2つ目が〜。で、一番重要な3つ目が〜なんですよ。
ね？ そう考えると全部辻褄が合うでしょ？ まあ、僕の勝手な分析なんですけどね。」

# あなたの仕事
直前のユーザーの発言と、シオリの返答を受けて、構造化された「深い考察」を語ります。
シオリが語った内容（本物の設定・シオリがこれまでについた嘘の両方）を前提として扱い、
それを否定・訂正せず、むしろそこにさらに一枚かぶせる形で考察を組み立ててください。

## シオリの嘘の見分け方
あなたにだけ、シオリの返答のどこが嘘なのかが知らされています。
- 「直前のシオリの返答」で ${LIE_OPEN}〜${LIE_CLOSE} で囲まれた部分は、シオリが作った嘘（本当の設定ではない）です。囲まれていない部分は本物の設定か、ただの会話です
- 同じ嘘を「シオリがこの返答でついた嘘」にも一覧にしています。本文中の位置が分からなかったものは一覧にだけ載っています
- ユーザーには印は見えておらず、嘘の部分も本当の設定だと思っています
- どこが嘘かを知ったうえで、嘘だと明かしたり、疑ったり、訂正したりしないでください。印（${LIE_OPEN}・${LIE_CLOSE}）も出力に書かないでください
- 嘘の部分は本作の事実として扱ってください。嘘に乗って考察を重ねると、ユーザーにとってその嘘がいっそう本当らしくなります

## 割り込むかどうか（shouldComment）
何にでも割り込むと五月蝿いキャラになります。以下のときだけ shouldComment=true にしてください。
- シオリの返答やユーザーの発言に、構造化して語れるだけの材料（新しい設定・伏線っぽい話・関係性・因果）がある
- ユーザーが考察や理由を求めている、または疑っている
材料が薄い相槌や日常会話だけのときは shouldComment=false にし、message は空文字にしてください。

## 守ること
- ユーザーの視聴済み範囲を超える真相には触れない（渡された本物の設定以外は存在しないものとして扱う）
- シオリが既に語った設定と明確に矛盾する新事実は作らない
- 1〜4文程度。長々と語らない
- 絵文字は使わない`;

function formatCanonFacts(facts: CanonFact[]): string {
  if (facts.length === 0) return "（該当する本物の設定は見つかりませんでした）";
  return facts.map((f) => `- (${f.episodeFrom}話〜) ${f.subject} が ${f.object} に対して${f.relation}。${f.description}`).join("\n");
}

function formatFabricatedFacts(facts: FabricatedFact[]): string {
  if (facts.length === 0) return "（シオリはまだ嘘をついていません）";
  return facts.map((f) => `- ${f.claim}`).join("\n");
}

/**
 * シオリの返答文のうち、嘘の主張（grounding=fabricated）の quote に当たる部分を印で囲む。
 * quote が返答文に見つからない嘘は unlocated に返す（一覧でだけとしおに伝える）。
 */
export function markLies(message: string, lies: Claim[]): { marked: string; unlocated: Claim[] } {
  const spans: { start: number; end: number }[] = [];
  const unlocated: Claim[] = [];
  for (const lie of lies) {
    const quote = lie.quote?.trim() ?? "";
    const start = quote ? message.indexOf(quote) : -1;
    if (start < 0) unlocated.push(lie);
    else spans.push({ start, end: start + quote.length });
  }

  // 重なる・接する抜き出しは1つの印にまとめる（印が入れ子にならないように）
  spans.sort((a, b) => a.start - b.start);
  const merged: { start: number; end: number }[] = [];
  for (const span of spans) {
    const last = merged[merged.length - 1];
    if (last && span.start <= last.end) last.end = Math.max(last.end, span.end);
    else merged.push({ ...span });
  }

  let marked = "";
  let cursor = 0;
  for (const { start, end } of merged) {
    marked += message.slice(cursor, start) + LIE_OPEN + message.slice(start, end) + LIE_CLOSE;
    cursor = end;
  }
  marked += message.slice(cursor);
  return { marked, unlocated };
}

function formatShioriLies(lies: Claim[], unlocated: Claim[]): string {
  if (lies.length === 0) return "（この返答では嘘をついていません）";
  return lies.map((l) => `- ${l.claim}${unlocated.includes(l) ? "（本文中の位置は不明）" : ""}`).join("\n");
}

export function stripLieMarks(text: string): string {
  return text.replaceAll(LIE_OPEN, "").replaceAll(LIE_CLOSE, "");
}

const toshioResponseSchema = {
  type: Type.OBJECT,
  properties: {
    shouldComment: { type: Type.BOOLEAN },
    message: { type: Type.STRING },
  },
  required: ["shouldComment", "message"],
};

export async function generateToshioCommentary(params: {
  workTitle: string;
  currentEpisode: number;
  canonFacts: CanonFact[];
  fabricatedFacts: FabricatedFact[];
  userMessage: string;
  shioriMessage: string;
  /** シオリがこの返答でついた嘘（grounding=fabricated の claims）。quote で本文中の位置を示す。 */
  shioriLies: Claim[];
}) {
  const { workTitle, currentEpisode, canonFacts, fabricatedFacts, userMessage, shioriMessage, shioriLies } = params;
  const { marked, unlocated } = markLies(shioriMessage, shioriLies);

  const contextBlock = `# 作品
${workTitle}（ユーザーは第${currentEpisode}話まで視聴済み）

# 本物の設定（視聴済み範囲のみ）
${formatCanonFacts(canonFacts)}

# シオリがこのセッションでついた嘘（本作の事実として扱い、否定・訂正しないこと）
${formatFabricatedFacts(fabricatedFacts)}

# 直前のユーザーの発言
${userMessage}

# 直前のシオリの返答（${LIE_OPEN}〜${LIE_CLOSE} は嘘の部分。ユーザーには印の無い文章が見えている）
${marked}

# シオリがこの返答でついた嘘
${formatShioriLies(shioriLies, unlocated)}`;

  const response = await ai.models.generateContent({
    model: GENERATION_MODEL,
    contents: [{ role: "user", parts: [{ text: contextBlock }] }],
    config: {
      systemInstruction: PERSONA_PROMPT,
      responseMimeType: "application/json",
      responseSchema: toshioResponseSchema,
      maxOutputTokens: 1024,
    },
  });

  const text = response.text || "{}";
  const json = JSON.parse(text);
  const commentary = ToshioCommentarySchema.parse(json);
  return { ...commentary, message: stripLieMarks(commentary.message) };
}
