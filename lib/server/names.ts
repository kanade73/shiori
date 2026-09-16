import { normalizeText } from "./claims";
import type { Arc, Entity, NameCorrection } from "./types";

/**
 * ユーザーの発話の中の「名前」を扱う。issue #1 のナックルベンチ
 * （「ハコワレ」= ハチワレの誤字か、「ナックル」= 別の作品か）を、作品を知らないコードで捌く。
 *
 * - 近似一致: 登場人物の名前・別名と1文字違いの語（誤字）を見つけ、正式名に対応づける
 * - 見知らぬ固有名詞: カタカナの語のうち、作品の名前（登場人物・編・作品名）のどれでもなく、
 *   会話の一般語でもないもの。外部資料にも無ければ別の作品かもしれない（other-work.ts）
 *
 * どちらもカタカナの語だけを見る。ひらがなの語は助詞・活用と切れ目なく続くので、
 * 1文字違いを探すと「あのとき」が「あのこ」の誤字に見えるような取り違えが多すぎる。
 */

/** 誤字とみなす語の最短の長さ。2文字だと「ハチ」「ハコ」のような普通の語まで名前の誤字になる */
export const MIN_NAME_LENGTH = 3;
/** 1文字違いまでを誤字とみなす（置換・脱字・余字のどれか1つ） */
export const MAX_NAME_DISTANCE = 1;

/**
 * 作品を問わず会話に出てくるカタカナ語。作品の資料に無くても別の作品の固有名詞ではない。
 * 作品ごとの語はここに足さず、work.json の entities / arcs か外部資料に任せる。
 */
const COMMON_KATAKANA = new Set(
  [
    "アニメ", "マンガ", "コミック", "キャラ", "キャラクター", "シーン", "ストーリー", "エピソード", "シリーズ",
    "セリフ", "ネタバレ", "オープニング", "エンディング", "オリジナル", "テレビ", "ラスト", "クライマックス",
    "ギャグ", "ホラー", "コメディ", "バトル", "ヒロイン", "ライバル", "リアル", "ファン", "ネット", "スマホ",
    "パート", "テーマ", "メッセージ", "イメージ", "デザイン", "スタッフ", "ページ", "タイトル", "サブタイ",
    "グッズ", "コラボ", "アイテム", "レベル", "ポイント", "ダメージ", "スピード", "パワー", "モチーフ",
    "メタファー", "アイデア", "パターン", "タイミング", "テンション", "モヤモヤ", "ドキドキ", "ワクワク",
    "ゾクゾク", "ニコニコ", "キラキラ", "ボロボロ", "ガチ", "マジ", "ヤバイ", "ヤバ", "エモい", "エモ",
  ].map(toKatakana),
);

/** ひらがなをカタカナに寄せ、幅も揃える（「はちわれ」と「ハチワレ」を同じ語として扱う） */
export function toKatakana(text: string): string {
  return text
    .normalize("NFKC")
    .replace(/[ぁ-ゖ]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) + 0x60))
    .replace(/[ゝ]/g, "ヽ")
    .replace(/[ゞ]/g, "ヾ");
}

/** 発話の中のカタカナの語（長音・中黒を含む連続）。「ちいかわ」のようなひらがなの語は拾わない */
export function katakanaWords(text: string): string[] {
  const words = text.normalize("NFKC").match(/[\p{Script=Katakana}ー]+/gu) ?? [];
  return words.filter((w) => w.replace(/ー/g, "").length > 0);
}

/** Levenshtein 距離。上限を超えたら早めに切り上げる */
export function editDistance(a: string, b: string, limit: number = Infinity): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > limit) return limit + 1;
  const prev = new Array<number>(b.length + 1);
  const curr = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    let rowMin = curr[0];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
      if (curr[j] < rowMin) rowMin = curr[j];
    }
    if (rowMin > limit) return limit + 1;
    for (let j = 0; j <= b.length; j++) prev[j] = curr[j];
  }
  return prev[b.length];
}

type KnownForm = { form: string; entity: string };

function entityForms(entities: Entity[]): KnownForm[] {
  const forms: KnownForm[] = [];
  for (const entity of entities) {
    for (const raw of [entity.name, ...entity.aliases]) {
      const form = toKatakana(normalizeText(raw));
      if (form.length > 0) forms.push({ form, entity: entity.name });
    }
  }
  return forms;
}

/**
 * 発話の中の、登場人物の名前と1文字違いのカタカナの語。
 * 「草むしり検定はハコワレが頑張っていた」→ [{ written: "ハコワレ", entity: "ハチワレ" }]。
 * 正式名・別名そのものは誤字ではない。2人以上の名前に同じ近さで当たる語は、誰の誤字か決められないので拾わない。
 */
export function findNameCorrections(entities: Entity[], userMessage: string): NameCorrection[] {
  const forms = entityForms(entities);
  const exact = new Set(forms.map((f) => f.form));
  const corrections: NameCorrection[] = [];
  const seen = new Set<string>();

  for (const word of katakanaWords(userMessage)) {
    if (word.length < MIN_NAME_LENGTH || seen.has(word)) continue;
    const key = toKatakana(normalizeText(word));
    if (exact.has(key)) continue;

    let best: { distance: number; entities: Set<string> } | null = null;
    for (const { form, entity } of forms) {
      if (form.length < MIN_NAME_LENGTH) continue;
      const distance = editDistance(key, form, MAX_NAME_DISTANCE);
      if (distance > MAX_NAME_DISTANCE) continue;
      if (!best || distance < best.distance) best = { distance, entities: new Set([entity]) };
      else if (distance === best.distance) best.entities.add(entity);
    }
    if (!best || best.entities.size !== 1) continue;
    seen.add(word);
    corrections.push({ written: word, entity: [...best.entities][0] });
  }
  return corrections;
}

/** 誤字を正式名に置き換えた発話。資料の検索と本物の設定の取り出しにはこちらを使う（シオリには元の文を渡す） */
export function applyNameCorrections(userMessage: string, corrections: NameCorrection[]): string {
  let text = userMessage;
  for (const c of corrections) text = text.split(c.written).join(c.entity);
  return text;
}

/**
 * 発話の中の、作品の名前（登場人物・編・作品名）のどれでもなく、会話の一般語でもない語。
 * 別の作品の話をしている手がかりの候補。外部資料に出てくる語はこの後 other-work.ts が落とす。
 *
 * 見るのはカタカナの語（3文字以上。正規表現で切れる）と、`extraWords` に渡された語
 * （形態素解析で切り出した固有名詞らしい語。morph.ts。漢字・かな混じりの名前はこちら）。
 */
export function unknownKatakanaWords(params: {
  userMessage: string;
  entities: Entity[];
  arcs: Arc[];
  workTitle: string;
  corrections?: NameCorrection[];
  /** 形態素解析で切り出した固有名詞らしい語。カタカナ以外もここから入る */
  extraWords?: string[];
}): string[] {
  const { userMessage, entities, arcs, workTitle, corrections = [], extraWords = [] } = params;
  const known = new Set<string>();
  for (const { form } of entityForms(entities)) known.add(form);
  for (const arc of arcs) for (const raw of [arc.title, ...arc.aliases]) known.add(toKatakana(normalizeText(raw)));
  known.add(toKatakana(normalizeText(workTitle)));
  const knownText = toKatakana(
    normalizeText(
      [workTitle, ...arcs.flatMap((a) => [a.title, ...a.aliases]), ...entities.flatMap((e) => [e.name, ...e.aliases])].join(" "),
    ),
  );
  const corrected = new Set(corrections.map((c) => c.written));

  const result: string[] = [];
  const candidates = [...katakanaWords(userMessage).filter((w) => w.length >= MIN_NAME_LENGTH), ...extraWords];
  for (const word of candidates) {
    if (corrected.has(word) || result.includes(word)) continue;
    const key = toKatakana(normalizeText(word));
    if (key.length === 0 || known.has(key) || COMMON_KATAKANA.has(key)) continue;
    // 編の名前・作品名・登場人物の名前の一部（「パジャマパーティーズ」の中の「パジャマ」）は見知らぬ語ではない
    if (knownText.includes(key)) continue;
    // 誤字と判定した語を含む並び（「ハコワレ先輩」）も見知らぬ語ではない
    if (corrections.some((c) => word.includes(c.written))) continue;
    result.push(word);
  }
  return result;
}
