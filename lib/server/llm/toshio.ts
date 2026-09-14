import { Type } from "@google/genai";
import { ai, GENERATION_MODEL } from "./client";
import { ToshioCommentarySchema } from "./schemas";
import type { CanonFact, FabricatedFact } from "../types";

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
  if (facts.length === 0) return "（シオリはまだ何も語っていません）";
  return facts.map((f) => `- ${f.claim}`).join("\n");
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
}) {
  const { workTitle, currentEpisode, canonFacts, fabricatedFacts, userMessage, shioriMessage } = params;

  const contextBlock = `# 作品
${workTitle}（ユーザーは第${currentEpisode}話まで視聴済み）

# 本物の設定（視聴済み範囲のみ）
${formatCanonFacts(canonFacts)}

# シオリがこのセッションで既に語った設定（否定・訂正しないこと）
${formatFabricatedFacts(fabricatedFacts)}

# 直前のユーザーの発言
${userMessage}

# 直前のシオリの返答
${shioriMessage}`;

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
  return ToshioCommentarySchema.parse(json);
}
