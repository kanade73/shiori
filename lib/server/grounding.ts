import { normalizeText, type Normalizer } from "./claims";
import type { ClaimRelation, SourceChunk } from "./types";

/**
 * シオリの主張が本物の設定を述べたものかを、言い換えに負けずに照合するための道具（extract.ts の grounding が使う）。
 *
 * 主張の object と本物の設定の書き方は、同じことでも少し違う（「カニのハサミみたいなカチューシャ」と
 * 「耳のようなカニのハサミのカチューシャ」）。文字列の丸ごとの包含だけで見ると本当のことが嘘の扱いになり、
 * 答え合わせで「嘘」の印が付いてしまう。そこで object を内容語に分け、それが同じ順で近くに並んでいれば
 * 同じことを述べているとみなす。逆に、本物の設定に無い語（「赤い」カチューシャ）が1つでも入っていれば
 * 一致しないので、小さな嘘は嘘のまま残る。
 */

const wordSegmenter = new Intl.Segmenter("ja", { granularity: "word" });

/**
 * 言い換えで入れ替わる機能語（「〜みたいな」「〜のような」「〜をした」など）。どの作品でも同じ日本語の語。
 * ひらがな1字の語（の・な・を・が など）は別に落とす。
 */
const FUNCTION_WORDS = new Set([
  "みたい",
  "よう",
  "ような",
  "っぽい",
  "など",
  "という",
  "といった",
  "した",
  "して",
  "する",
  "ある",
  "いる",
  "です",
  "こと",
  "もの",
]);
const HIRAGANA_ONLY = /^[\p{Script=Hiragana}ー]+$/u;

/** 内容語どうしの間に挟まってよい字数。これより離れていれば、別々のことを言っている文とみなす */
const MAX_GAP = 6;

/** object を照合用の内容語に分ける（正規化した上で、機能語を落とす）。 */
export function contentWords(text: string): string[] {
  return [...wordSegmenter.segment(normalizeText(text))]
    .filter((s) => s.isWordLike)
    .map((s) => s.segment)
    .filter((w) => !(HIRAGANA_ONLY.test(w) && w.length === 1) && !FUNCTION_WORDS.has(w));
}

/**
 * 語が text の中に、この順で、間を MAX_GAP 字以内にして並んでいるか。
 * 語ごとの候補（別名 → 正式名など）のどれかが当たればよい。
 */
export function wordsInOrder(text: string, words: string[][]): boolean {
  const from = (index: number, start: number, first: boolean): boolean => {
    if (index === words.length) return true;
    for (const form of words[index]) {
      if (form.length === 0) continue;
      for (let at = text.indexOf(form, start); at >= 0; at = text.indexOf(form, at + 1)) {
        if (!first && at - start > MAX_GAP) break;
        if (from(index + 1, at + form.length, false)) return true;
      }
    }
    return false;
  };
  return words.length > 0 && from(0, 0, true);
}

/** 内容語ごとの照合候補。別名で書かれていても正式名で探せるようにする */
function wordForms(words: string[], normalize: Normalizer): string[][] {
  return words.map((w) => Array.from(new Set([w, normalizeText(normalize(w))])));
}

/** 主張の object の内容語が、本物の設定の文（object か説明文）に順に近く並んでいるか。 */
export function paraphraseMatches(claimObject: string, canonTexts: string[], normalize: Normalizer): boolean {
  const words = contentWords(claimObject);
  if (words.length === 0) return false;
  const forms = wordForms(words, normalize);
  return canonTexts.some((t) => wordsInOrder(normalizeText(t), forms));
}

/**
 * 外部資料の本文を、主張と照合できる大きさ（読点で区切った節）に分けたもの。
 * 資料係が事実に要約したときに落ちた細部も、本物の設定として照合できるようにする。
 */
export type SourceClause = {
  /** 正規化した節の本文 */
  text: string;
  /** この節が何について述べているか（正式名）。節に出てくる登場人物、無ければ同じ文の前の節、それも無ければ段落の見出し */
  subjects: string[];
  /** 節に出てくる登場人物の正式名 */
  names: string[];
};

/** 否定を含む節は、語が並んでいても逆のことを言っている（「シルエットではない」）ので照合に使わない */
const NEGATION = /ない|なかっ|ません|ではなく|じゃな/;

/**
 * 段落を節に分ける。純粋関数。`names` は本文に出てくる登場人物の正式名を返す関数（sources.mentionedNames）。
 * 人物の段落は「性格は内気で恥ずかしがり屋。」のように主語を書かないので、見出し（キャラ名）を主語にする。
 */
export function sourceClauses(chunks: SourceChunk[], names: (text: string) => string[], normalize: Normalizer): SourceClause[] {
  const clauses: SourceClause[] = [];
  for (const chunk of chunks) {
    const label = chunk.label.trim();
    const labelNames = label ? names(label) : [];
    const labelSubjects = labelNames.length > 0 ? labelNames : label ? [normalize(label)] : [];
    for (const sentence of chunk.text.split(/[\n。]+/)) {
      let subjects = labelSubjects;
      for (const part of sentence.split(/[、，,]/)) {
        const text = normalizeText(part);
        if (text.length === 0 || text === normalizeText(label)) continue;
        const mentioned = names(part);
        if (mentioned.length > 0) subjects = mentioned;
        if (NEGATION.test(text)) continue;
        clauses.push({ text, subjects, names: mentioned });
      }
    }
  }
  return clauses;
}

/**
 * 資料の節で照合してよい関係。好き嫌い・できる/できない・人間関係・正体・由来は、関係そのものに
 * 意味があり、object の語が節に並んでいるだけでは同じことを言っているとは限らない
 * （「モモンガとはモブの頃から面識がある」は「モモンガが嫌い」の根拠にならない）。
 */
const CLAUSE_RELATIONS = new Set<ClaimRelation>(["is", "has", "did", "lives_in", "first_appeared", "other"]);

/**
 * 主張が資料の節のどれかに書かれているか。object の内容語が2語以上あり、登場人物の名前以外の語を含み、
 * それが主語について述べた1つの節に順に近く並んでいるときだけ一致とする。
 * 1語だけ（「カニ」）では、節にその語があるだけで何を述べているかまでは言えないので使わない。
 */
export function matchSourceClauses(
  claim: { subject: string; relation: ClaimRelation; object: string; negated: boolean },
  clauses: SourceClause[],
  normalize: Normalizer,
): boolean {
  if (claim.negated || !CLAUSE_RELATIONS.has(claim.relation)) return false;
  const subject = normalize(claim.subject);
  const words = contentWords(claim.object);
  if (subject.length === 0 || words.length < 2) return false;
  const forms = wordForms(words, normalize);

  return clauses.some((clause) => {
    if (!clause.subjects.includes(subject)) return false;
    const nameForms = new Set(clause.names.map((n) => normalizeText(n)));
    const describes = forms.some((f) => !f.some((form) => nameForms.has(form)));
    return describes && wordsInOrder(clause.text, forms);
  });
}
