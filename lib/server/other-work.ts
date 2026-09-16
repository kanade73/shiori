import { loadSourceChunks } from "./sources";
import { getSources } from "./works";
import { katakanaWords, toKatakana } from "./names";
import { normalizeText } from "./claims";
import { judgeOtherWork } from "./llm/other-work";
import type { SourceChunk } from "./types";

/**
 * 別の作品の話をしていないか（issue #1 ナックルベンチのルート1）。2段で判定する。
 *
 * 1. ゲート（API を呼ばない）: 発話の見知らぬカタカナ語（names.ts の unknownKatakanaWords。
 *    登場人物・編・作品名のどれでもなく、会話の一般語でもない）のうち、外部資料の本文にも
 *    出てこないものだけを残す。資料は作品の語彙（脇役・用語・アニメ制作の一般語）を広く含むので、
 *    ここでほとんどの語が落ちる
 * 2. 判定役（llm/other-work.ts、軽いモデル・小さな文脈）: 残った語が別の作品のものか、なら作品名
 *
 * 失敗しても null（本作の話として続ける）。
 */

export type OtherWorkDetection = { otherWork: string; names: string[] };

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
  /** 発話の見知らぬカタカナ語（unknownKatakanaWords の結果） */
  unknownNames: string[];
}): Promise<OtherWorkDetection | null> {
  const { workId, workTitle, userMessage, unknownNames } = params;
  if (unknownNames.length === 0) return null;

  try {
    // 外部の知識源が無い作品では資料で落とせないので、見知らぬ語をそのまま判定役に見せる
    const chunks = getSources(workId).length > 0 ? await loadSourceChunks(workId).catch(() => [] as SourceChunk[]) : [];
    const names = namesMissingFromSources(unknownNames, chunks);
    if (names.length === 0) return null;

    const verdict = await judgeOtherWork({ workTitle, userMessage, names });
    // 判定役を呼んだ回だけ残す（ゲートの誤検知の頻度を後から見られるように）
    console.info(`[other-work] ${names.join("・")} → ${verdict.otherWork ? `別の作品「${verdict.otherWork}」` : "本作の話"}`);
    if (!verdict.otherWork) return null;
    return { otherWork: verdict.otherWork, names };
  } catch (error) {
    console.error("別の作品かの判定に失敗（本作の話として続ける）:", error);
    return null;
  }
}
