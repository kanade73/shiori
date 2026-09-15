import { getArcs, getSources, getWork } from "./works";
import { fuseRankings, loadSourceChunks, mentionedNames, rankChunks } from "./sources";
import { rankChunksByVector } from "./embeddings";
import { extractTopic } from "./llm/topic";
import { normalizeText } from "./claims";
import type { Arc, CanonFact, SessionTopic } from "./types";

/**
 * issue #14: セッションごとの RAG。会話の最初の返答で、ユーザーが話したい場面を外部の
 * 知識源から特定し、その場面の事実をセッションに持たせる。以後は話題が切り替わったと
 * 判定したとき（topic-shift.ts）だけ引き直す。
 * 話数を手で入れさせていたシーン検索（progress-resolver）の置き換え。
 */

/** 資料係（LLM）に渡す段落の数。言い換えの大きい答えだと目的の段落が5〜6番目に来ることがある */
const MAX_CHUNKS = 8;
/** 順位を混ぜる前に、bigram・ベクトルそれぞれから取る段落の数 */
const FUSION_DEPTH = 30;
// これ未満の重なりしかない発話（挨拶など）では、資料係を呼ぶまでもなく「話題なし」とする。
// ひらがなだけの重なりは弱く数えるので、漢字・カタカナの2文字が1つ重なる程度が目安
const MIN_SCORE = 3;

/** 場面の名前（や資料の段落の見出し）に、arc の名前・別名が含まれていればその arc。長く一致したものを優先する */
export function matchArc(arcs: Arc[], texts: string[]): Arc | null {
  const haystacks = texts.map(normalizeText).filter((t) => t.length > 0);
  let best: { arc: Arc; length: number } | null = null;
  for (const arc of arcs) {
    for (const form of [arc.title, ...arc.aliases]) {
      const needle = normalizeText(form);
      if (needle.length < 2) continue;
      if (haystacks.some((h) => h.includes(needle)) && (!best || needle.length > best.length)) {
        best = { arc, length: needle.length };
      }
    }
  }
  return best?.arc ?? null;
}

/**
 * 話題の場面から分かる「少なくともここまでは見ている」話数。
 * 場面が arc に対応すればその arc の最後の話（「〇〇編の話がしたい」は見終えている前提）、
 * 対応しなければ 0（話数では何も開けない）。
 */
export function episodeBoundaryFor(workId: string, topic: SessionTopic | null | undefined): number {
  if (!topic?.arcId) return 0;
  const arc = getArcs(workId).find((a) => a.id === topic.arcId);
  if (!arc) return 0;
  const count = getWork(workId)?.episodeCount;
  return count ? Math.min(arc.episodeTo, count) : arc.episodeTo;
}

/** 同じ場面を指しているか（切り替えたつもりで同じ場面を引き直したときは、切り替えとみなさない） */
export function isSameTopic(a: SessionTopic, b: SessionTopic): boolean {
  if (a.arcId && b.arcId) return a.arcId === b.arcId;
  return normalizeText(a.title) === normalizeText(b.title);
}

/**
 * ユーザーの発話から話題の場面を調べる。外部の知識源が無い作品、話題が特定できない発話、
 * 取得や生成の失敗ではすべて null（シオリはそのまま返事をし、次の発話でまた調べる）。
 *
 * `query` は検索に使う語（話題の切り替えでは判定役が指示語を解いて組み直したもの）。
 * 無ければ発話そのもの。`ordinal` はセッションで何番目の話題か（事実の id を話題ごとに分ける）。
 */
export async function lookupSessionTopic(params: {
  workId: string;
  workTitle: string;
  userMessage: string;
  query?: string;
  ordinal?: number;
}): Promise<SessionTopic | null> {
  const { workId, workTitle, userMessage } = params;
  const query = params.query?.trim() || userMessage;
  const ordinal = params.ordinal ?? 1;
  if (getSources(workId).length === 0) return null;

  try {
    const chunks = await loadSourceChunks(workId);
    const lexical = rankChunks(query, chunks, mentionedNames(workId, query));
    // 挨拶のように資料とほとんど重ならない発話では、埋め込みも資料係も呼ばない
    if ((lexical[0]?.score ?? 0) < MIN_SCORE) return null;

    // 言い換えに強いベクトル検索と順位を混ぜる。段落の埋め込みがまだ揃っていなければ bigram だけ
    const semantic = await rankChunksByVector(query, chunks);
    const ranked = semantic
      ? fuseRankings([lexical.slice(0, FUSION_DEPTH), semantic.slice(0, FUSION_DEPTH)])
      : lexical;
    const candidates = ranked.slice(0, MAX_CHUNKS).map((r) => r.chunk);

    const extraction = await extractTopic({
      workTitle,
      userMessage,
      ...(query !== userMessage ? { query } : {}),
      chunks: candidates,
    });
    const title = extraction.title.trim();
    if (!extraction.found || !title) return null;

    const usedIds = new Set([...extraction.chunkIds, ...extraction.facts.map((f) => f.chunkId)]);
    const used = candidates.filter((c) => usedIds.has(c.id));
    const arc = matchArc(getArcs(workId), [title, ...used.map((c) => c.label)]);

    const facts: CanonFact[] = extraction.facts.map((f, i) => ({
      id: `topic-${ordinal}-${i + 1}`,
      workId,
      // arc が分かればその始まりの話、分からなければ話数の境界に関係なく見せる（話題そのものなので）
      episodeFrom: arc?.episodeFrom ?? 0,
      subject: f.subject,
      relation: f.relation,
      object: f.object,
      description: f.description,
    }));

    const sources = Array.from(
      new Map((used.length > 0 ? used : candidates).map((c) => [c.url, { title: c.sourceTitle, url: c.url }])).values(),
    );

    return {
      title,
      summary: extraction.summary.trim(),
      ...(arc ? { arcId: arc.id } : {}),
      facts,
      sources,
      chunkIds: (used.length > 0 ? used : candidates).map((c) => c.id),
      query: userMessage,
      resolvedAt: new Date().toISOString(),
    };
  } catch (error) {
    console.error("話題の場面の特定に失敗:", error);
    return null;
  }
}
