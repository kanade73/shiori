import { getArcs, getSources, getWork } from "./works";
import { loadSourceChunks, mentionedNames, rankChunks } from "./sources";
import { extractTopic } from "./llm/topic";
import { normalizeText } from "./claims";
import type { Arc, CanonFact, SessionTopic } from "./types";

/**
 * issue #14: セッションごとの RAG。会話の最初の返答で、ユーザーが話したい場面を外部の
 * 知識源から特定し、その場面の事実をセッションに持たせる（以後の発話では外部を引かない）。
 * 話数を手で入れさせていたシーン検索（progress-resolver）の置き換え。
 */

/** 資料係（LLM）に渡す段落の数。言い換えの大きい答えだと目的の段落が5〜6番目に来ることがある */
const MAX_CHUNKS = 8;
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

/**
 * ユーザーの発話から話題の場面を調べる。外部の知識源が無い作品、話題が特定できない発話、
 * 取得や生成の失敗ではすべて null（シオリはそのまま返事をし、次の発話でまた調べる）。
 */
export async function lookupSessionTopic(params: {
  workId: string;
  workTitle: string;
  userMessage: string;
}): Promise<SessionTopic | null> {
  const { workId, workTitle, userMessage } = params;
  if (getSources(workId).length === 0) return null;

  try {
    const chunks = await loadSourceChunks(workId);
    const candidates = rankChunks(userMessage, chunks, mentionedNames(workId, userMessage))
      .filter((r) => r.score >= MIN_SCORE)
      .slice(0, MAX_CHUNKS)
      .map((r) => r.chunk);
    if (candidates.length === 0) return null;

    const extraction = await extractTopic({ workTitle, userMessage, chunks: candidates });
    const title = extraction.title.trim();
    if (!extraction.found || !title) return null;

    const usedIds = new Set([...extraction.chunkIds, ...extraction.facts.map((f) => f.chunkId)]);
    const used = candidates.filter((c) => usedIds.has(c.id));
    const arc = matchArc(getArcs(workId), [title, ...used.map((c) => c.label)]);

    const facts: CanonFact[] = extraction.facts.map((f, i) => ({
      id: `topic-${i + 1}`,
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
      query: userMessage,
      resolvedAt: new Date().toISOString(),
    };
  } catch (error) {
    console.error("話題の場面の特定に失敗:", error);
    return null;
  }
}
