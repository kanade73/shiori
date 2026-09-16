import path from "node:path";
import kuromoji, { type IpadicFeatures, type Tokenizer } from "kuromoji";

/**
 * 形態素解析（kuromoji.js + IPADIC。純 JS、辞書 約17MB、組み立て 約150ms・1発話 1ms 未満）。
 * 使うのは1つだけ: 発話の中の「固有名詞らしい語」を切り出すこと（issue #1 ナックルベンチ）。
 * カタカナの語は names.ts が正規表現で拾えるが、漢字・かな混じりの名前（炭治郎・五条悟・悟空）は
 * 分かち書きが無いと切り出せない。
 *
 * 汎用の辞書にアニメの登場人物は載っていないので、名前は割れて出てくる（炭[人名] 治郎[人名]、
 * 禰[未知語] 豆 子、悟[人名] 空）。そこで、名詞が続く並びを1語にまとめ、その中に固有名詞か
 * 未知語が1つでもあれば候補にする。一般名詞だけの並び（感動シーン・最終回）は候補にしない。
 * 辞書は一度組み立てたらプロセス内で持つ（HMR で作り直さないよう globalThis に置く）。
 */

const DIC_PATH = path.join(process.cwd(), "node_modules", "kuromoji", "dict");

type Shared = typeof globalThis & { __kuromojiTokenizer?: Promise<Tokenizer<IpadicFeatures>> };

export function getTokenizer(): Promise<Tokenizer<IpadicFeatures>> {
  const shared = globalThis as Shared;
  if (!shared.__kuromojiTokenizer) {
    shared.__kuromojiTokenizer = new Promise((resolve, reject) => {
      kuromoji.builder({ dicPath: DIC_PATH }).build((err, tokenizer) => (err ? reject(err) : resolve(tokenizer)));
    });
    // 組み立てに失敗したら次回また試す
    shared.__kuromojiTokenizer.catch(() => {
      shared.__kuromojiTokenizer = undefined;
    });
  }
  return shared.__kuromojiTokenizer;
}

/** 名詞の並びに含めない名詞の細分類（「これ」「こと」「3」など） */
const EXCLUDED_NOUN_DETAILS = new Set(["非自立", "代名詞", "数", "副詞可能"]);
/** 固有名詞のうち、辞書に載っている地名は作品の名前ではまず無い（東京・京都）。未知語ならこの限りではない */
const EXCLUDED_PROPER_DETAILS = new Set(["地域"]);

function isNounPiece(t: IpadicFeatures): boolean {
  return t.pos === "名詞" && !EXCLUDED_NOUN_DETAILS.has(t.pos_detail_1);
}

/** 固有名詞か未知語か。ここが1つでもあれば、その名詞の並びは名前かもしれない */
function isNameSignal(t: IpadicFeatures): boolean {
  if (t.word_type === "UNKNOWN") return true;
  return t.pos_detail_1 === "固有名詞" && !EXCLUDED_PROPER_DETAILS.has(t.pos_detail_2);
}

const HIRAGANA_ONLY = /^[\p{Script=Hiragana}ー]+$/u;

/**
 * 発話の中の固有名詞らしい語（名詞の並びで、固有名詞か未知語を含むもの）。
 * ひらがなだけの並びは拾わない（「ちいかわ」が「ちい」[人名]と割れるように、かなの名前は辞書で
 * まともに切れない。ひらがなの名前は entities の別名一致に任せる）。2文字未満・数だけの語も拾わない。
 * 同じ語は1回。
 */
export function properNounCandidatesFromTokens(tokens: IpadicFeatures[]): string[] {
  const result: string[] = [];
  let run: IpadicFeatures[] = [];
  const flush = () => {
    if (run.length > 0 && run.some(isNameSignal)) {
      const word = run.map((t) => t.surface_form).join("");
      if (word.length >= 2 && !HIRAGANA_ONLY.test(word) && !/^\d+$/.test(word) && !result.includes(word)) result.push(word);
    }
    run = [];
  };
  for (const t of tokens) {
    if (isNounPiece(t)) run.push(t);
    else flush();
  }
  flush();
  return result;
}

export async function properNounCandidates(text: string): Promise<string[]> {
  const tokenizer = await getTokenizer();
  return properNounCandidatesFromTokens(tokenizer.tokenize(text.normalize("NFKC")));
}
