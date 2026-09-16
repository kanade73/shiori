import { loadSourceChunks } from "./sources";
import { getSources } from "./works";
import { katakanaWords, toKatakana } from "./names";
import { normalizeText } from "./claims";
import { lookupWorkOfName, pickWork } from "./wiki-lookup";
import type { SourceChunk } from "./types";

/**
 * 別の作品の話をしていないか（issue #1 ナックルベンチのルート1）。LLM は使わず2段で判定する。
 *
 * 1. ゲート（通信しない）: 発話の見知らぬ語（names.ts の unknownKatakanaWords。登場人物・編・作品名の
 *    どれでもなく、会話の一般語でもないカタカナ語と、形態素解析で切り出した固有名詞らしい語）のうち、
 *    外部資料の本文にも出てこないものだけを残す。資料は作品の語彙（脇役・用語・アニメ制作の一般語）を
 *    広く含むので、ここでほとんどの語が落ちる
 * 2. Wikipedia の検索（wiki-lookup.ts。キー不要・語ごとに HTTP 1回）: 残った語がどの作品のものかを
 *    記事名と冒頭文の決定的な規則で読む。複数の語が解けたら多数決
 *
 * 有名な作品が拾えれば十分（マイナーな作品まで対応し切る気はない。ユーザー判断）。失敗しても null（本作の話として続ける）。
 */

export type OtherWorkDetection = { otherWork: string; names: string[] };

/** 1発話で Wikipedia に聞く語の上限。連続で叩くと 429 を返すので絞る */
const MAX_LOOKUPS = 3;

/**
 * 外部資料の本文に出てこない語だけ残す（本作の語彙を作品ごとに書かずに済ませる）。
 * カタカナの語は、資料の側もカタカナの語（連続）に切って語ごと一致するものだけを「資料にある」とみなす
 * （部分一致にすると「ナックル」が「ナックルダスター」（ちいかわの記事にある）に吸われて落ちる）。
 * 漢字・かな混じりの語（形態素解析で切り出した名前）は資料の本文に含まれていれば「資料にある」。
 */
const KATAKANA_WORD = /^[\p{Script=Katakana}ー]+$/u;
export function namesMissingFromSources(names: string[], chunks: SourceChunk[]): string[] {
  if (names.length === 0) return [];
  const text = chunks.map((c) => `${c.label} ${c.heading} ${c.text}`).join(" ");
  const corpusWords = new Set(katakanaWords(text).map((w) => toKatakana(normalizeText(w))));
  const corpusText = normalizeText(text);
  return names.filter((name) =>
    KATAKANA_WORD.test(name) ? !corpusWords.has(toKatakana(normalizeText(name))) : !corpusText.includes(normalizeText(name)),
  );
}

export async function detectOtherWork(params: {
  workId: string;
  workTitle: string;
  userMessage: string;
  /** 発話の見知らぬ語（unknownKatakanaWords の結果） */
  unknownNames: string[];
}): Promise<OtherWorkDetection | null> {
  const { workId, workTitle, unknownNames } = params;
  if (unknownNames.length === 0) return null;

  try {
    // 外部の知識源が無い作品では資料で落とせないので、見知らぬ語をそのまま Wikipedia に聞く
    const chunks = getSources(workId).length > 0 ? await loadSourceChunks(workId).catch(() => [] as SourceChunk[]) : [];
    const names = namesMissingFromSources(unknownNames, chunks).slice(0, MAX_LOOKUPS);
    if (names.length === 0) return null;

    const resolved = await Promise.all(names.map((name) => lookupWorkOfName(name, workTitle)));
    const picked = pickWork(resolved);
    // Wikipedia に聞いた回だけ残す（ゲートの誤検知の頻度を後から見られるように）
    console.info(
      `[other-work] ${names.map((n, i) => `${n}${resolved[i] ? `→${resolved[i]!.work}` : ""}`).join("・")} → ${picked ? `別の作品「${picked.work}」` : "本作の話"}`,
    );
    if (!picked) return null;
    return { otherWork: picked.work, names };
  } catch (error) {
    console.error("別の作品かの判定に失敗（本作の話として続ける）:", error);
    return null;
  }
}
