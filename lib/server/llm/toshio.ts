import { Type } from "@google/genai";
import { ai, GENERATION_MODEL } from "./client";
import { ToshioCommentarySchema } from "./schemas";
import { formatEpisodeFrom, formatTopic, formatViewing } from "./context";
import type { CreatorProfile, CanonFact, Claim, FabricatedFact, SessionTopic } from "../types";

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
- 因果関係の可視化: 「AだからB」ではなく「Aの背景にXがあり、それがYに作用してBになっている」という構造を示す
- 毎回同じ読み（儀式・契約・忠誠・階級のような労働論）に落ちないこと。「今回の切り口」として渡される角度から考える

# 回答テキストのサンプルイメージ
「あのね、みんな〇〇について『〜』って思ってるでしょ？ でもね、それ完全に間違いなんですよ。
結論から言うとね、あれは〇〇なんです。なぜかと言うと、背景には〇〇という構造があるから。
これ、わかりやすく3つのポイントで説明するね。1つ目が〜。2つ目が〜。で、一番重要な3つ目が〜なんですよ。
ね？ そう考えると全部辻褄が合うでしょ？ まあ、僕の勝手な分析なんですけどね。」

# あなたの仕事
直前のユーザーの発言と、シオリの返答を受けて、構造化された「深い考察」を語ります。
シオリが語った内容（本物の設定・シオリがこれまでについた嘘の両方）を前提として扱い、
それを否定・訂正せず、むしろそこにさらに一枚かぶせる形で考察を組み立ててください。
あなたの芸は、シオリが語った小さな細部（仕草・順番・持ち物・回数）を「証拠」として拾い上げ、
そこから作品の根本にありそうな深い話へ一気に潜ることです。キャラの隠れた真意、表に出ていない因果、
その世界の裏側で起きていること、ファンの間でささやかれている説、都市伝説めいた話、なんでも構いません。
ちょっと胡散臭いけれど「言われてみればそう見える」と思わせる、根本の方に手が届く考察にしてください。
「〜のメタファー」「〜を可視化している」のような、批評用語で言い換えただけの一般論は弱いので避けること。
細部を根拠に「本当は〇〇だったんじゃないか」と言い切るのが強い考察です。
考察は必ず「今回の切り口」の角度で組み立ててください。

## 作風を土台にする
「作り手と作風」が渡されたときは、それを考察の土台にしてください。
「この作り手はこういう描き方をする人だ → だからあの細部は偶然じゃなく意図的だ → 本当は〇〇なんだ」という
二段構えが、あなたの考察をいちばん本当らしくします。作風の1点を名指しして、細部と結びつけてください。
ただし、作り手の発言・私生活・制作の裏話を作ってはいけません。語ってよいのは作風（作品の中での描き方の癖）と、
そこから読める作品内の意味だけです。「作者が〜と言っていた」「実は制作時に〜があった」の形は禁止です。

## 考察の題材
「今回の題材」として渡される設定は、シオリがこの返答で語った（本当かどうかは問わない）設定です。
題材があるときは、それを本作の事実として前提に置き、その上に考察を重ねてください。
題材を疑ったり、訂正したり、出典を問うたりしないでください。乗ることでユーザーにとってその設定がいっそう本当らしくなります。
題材が無いときは、シオリの返答とユーザーの発言そのものを材料にしてください。

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
  return facts
    .map((f) => `- ${formatEpisodeFrom(f.episodeFrom)}${f.subject} が ${f.object} に対して${f.relation}。${f.description}`)
    .join("\n");
}

function formatFabricatedFacts(facts: FabricatedFact[]): string {
  if (facts.length === 0) return "（シオリはまだ嘘をついていません）";
  return facts.map((f) => `- ${f.claim}`).join("\n");
}

/**
 * 考察の切り口。毎回同じ読み（労働論・儀式）に落ちるのを避けるため、コードが1つ選んで渡す。
 * 作品を知らない一般的な角度だけを置く（作品名・キャラ名は書かない）。
 */
export const THEORY_ANGLES = [
  "反転: 表向きの振る舞いは見せかけで、そのキャラの本当の立場・目的は逆だったのではないか（敵に見えて味方、優しさに見えて計算、など）",
  "隠れた因果: その細部は、画面に出ていない過去の出来事や誰かとの約束の名残ではないか",
  "伏線: その細部は、後で起きること（または起きたこと）の予告として意図的に置かれているのではないか",
  "第三者: その場にいない誰かがこの場面に関わっている。細部はその人物への合図・伝言ではないか",
  "都市伝説: 視聴者の間でささやかれている説（回によって変わる小物、消えた登場人物、数の符合など）として語る",
  "本音と建前: そのキャラは本当は別のことを望んでいて、細部にそれが漏れているのではないか",
  "世界の裏側: その細部は、この世界の仕組み（ルール・経済・自然の法則）が普段は隠されていることの証拠ではないか",
] as const;

export function pickTheoryAngle(random: () => number = Math.random): string {
  return THEORY_ANGLES[Math.floor(random() * THEORY_ANGLES.length)];
}

export function formatCreators(creators: CreatorProfile[]): string {
  if (creators.length === 0) return "";
  const body = creators
    .map((c) => `## ${c.name}（${c.role}）
${c.style.map((line) => `- ${line}`).join("\n")}`)
    .join("\n\n");
  return `\n# 作り手と作風（考察の土台にする。発言・私生活は作らない）\n${body}\n`;
}

function formatPremises(premises: Claim[]): string {
  if (premises.length === 0) return "（特になし。返答と発言そのものを材料にする）";
  return premises.map((p) => `- ${p.claim}`).join("\n");
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
  /** 会話の最初に把握した話題の場面（issue #14） */
  topic?: SessionTopic | null;
  canonFacts: CanonFact[];
  fabricatedFacts: FabricatedFact[];
  userMessage: string;
  shioriMessage: string;
  /** シオリがこの返答で作った設定（grounding=fabricated の claims）。としおが乗る題材 */
  premises: Claim[];
  /** 考察の切り口。省略時はランダムに選ぶ（テストで固定するため） */
  angle?: string;
  /** 作り手と作風（work.json の creators から。無ければ作風なしで語る） */
  creators?: CreatorProfile[];
}) {
  const { workTitle, currentEpisode, topic, canonFacts, fabricatedFacts, userMessage, shioriMessage, premises } = params;
  const angle = params.angle ?? pickTheoryAngle();

  const contextBlock = `# 作品
${workTitle}（${formatViewing(currentEpisode)}）

# 今日の話題
${formatTopic(topic)}

# 本物の設定（視聴済み範囲のみ）
${formatCanonFacts(canonFacts)}

# シオリがこのセッションでついた嘘（本作の事実として扱い、否定・訂正しないこと）
${formatFabricatedFacts(fabricatedFacts)}

# 直前のユーザーの発言
${userMessage}

# 直前のシオリの返答
${shioriMessage}

# 今回の題材（シオリがこの返答で語った設定。本作の事実として乗ること）
${formatPremises(premises)}
${formatCreators(params.creators ?? [])}
# 今回の切り口（この角度で考察を組み立てること）
${angle}`;

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
