import { getArcs, getSources, getWork } from "./works";
import { fuseRankings, loadSourceChunks, mentionedNames, rankChunks, type RankedChunk } from "./sources";
import { ensureChunkEmbeddings, rankChunksByVector } from "./embeddings";
import { extractTopic } from "./llm/topic";
import { normalizeText, type Normalizer } from "./claims";
import { sourceClauses, type SourceClause } from "./grounding";
import type { Arc, CanonFact, SessionTopic, SourceChunk } from "./types";

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
// 文字ではほとんど重ならなくても、意味の近さ（コサイン類似度）がこれ以上の段落があれば話題を探す
// （「牢屋のとこ」→『プリズン』編）。gemini-embedding-001・768次元で測った目安で、挨拶や相づち15種の
// 最も近い段落は 0.60〜0.65、文字では重ならない場面の言い換えは 0.66〜0.68 だった（差は小さい）
const MIN_SIMILARITY = 0.66;

/** 小書きの仮名を並字に寄せる（資料の「三ッ星」と arc の「三ツ星」を同じに見る） */
function foldSmallKana(text: string): string {
  return text.replace(/[ぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 1));
}

function matchForm(text: string): string {
  return foldSmallKana(normalizeText(text));
}

// 見出しの前後編・副題などの飾り（<後>・（擬態型）・〈…〉・[…]）
const NAME_QUALIFIER = /<[^>]*>|〈[^〉]*〉|\([^)]*\)|\[[^\]]*\]/g;
// 見出しの芯が途中で切れている（『シーサーの』編）とき、arc の名前の頭と照らすのに要る長さ。
// 短いと、人物名だけの芯（シーサー）がその人物の編に吸い寄せられる
const MIN_PREFIX_CORE = 3;

/**
 * 編の名前から飾りを除いた芯。「『黒い流れ星<後>』編」→「黒い流れ星」、「カブトムシ編（擬態型）」→「カブトムシ」。
 * 『』で囲まれているか「編」で終わる、編の名前の形のときだけ返す（人物名などの話題の名前は null）。
 */
export function arcNameCore(text: string): string | null {
  const stripped = text.normalize("NFKC").replace(NAME_QUALIFIER, "").trim();
  const bare = stripped.replace(/[『』「」]/g, "");
  if (!stripped.includes("『") && !bare.endsWith("編")) return null;
  const core = matchForm(bare.replace(/編$/, ""));
  return core.length > 0 ? core : null;
}

/**
 * 場面の名前（や資料の段落の見出し）から arc を引く。長く一致したものを優先する。
 * - 名前に arc の名前・別名が含まれている
 * - 編の名前の形なら、飾りを除いた芯が arc の名前・別名の芯と同じか（『黒い流れ星<後>』編 → 黒い流れ星編）、
 *   3文字以上の芯が arc の芯の頭と一致する（見出しが途中で切れた『シーサーの』編 → シーサーの資格編）
 * 資料の見出しの呼び方に合わせて作品ごとに別名を足さなくても、表記のゆれは吸収する（issue #33）。
 */
export function matchArc(arcs: Arc[], texts: string[]): Arc | null {
  const haystacks = texts.map(matchForm).filter((t) => t.length > 0);
  const headingCores = texts.map(arcNameCore).filter((c): c is string => c !== null);
  let best: { arc: Arc; length: number } | null = null;
  for (const arc of arcs) {
    for (const form of [arc.title, ...arc.aliases]) {
      const needle = matchForm(form);
      const formCore = arcNameCore(form);
      const lengths = [
        needle.length >= 2 && haystacks.some((h) => h.includes(needle)) ? needle.length : 0,
        ...headingCores.map((core) =>
          formCore && (core === formCore || (core.length >= MIN_PREFIX_CORE && formCore.startsWith(core))) ? core.length : 0,
        ),
      ];
      const length = Math.max(...lengths);
      if (length > 0 && (!best || length > best.length)) best = { arc, length };
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
 * 資料係に渡す段落を選ぶ。文字で十分に重なれば bigram とベクトルの順位を混ぜ、文字ではほとんど
 * 重ならない曖昧な言い方なら、意味の近い段落だけ（bigram の偶然の重なりは混ぜない）。
 * どちらでも足りなければ空（話題なし。資料係を呼ばない）。
 */
export function selectCandidates(lexical: RankedChunk[], semantic: RankedChunk[] | null): SourceChunk[] {
  const lexicalHit = (lexical[0]?.score ?? 0) >= MIN_SCORE;
  let ranked: RankedChunk[];
  if (lexicalHit) {
    ranked = semantic ? fuseRankings([lexical.slice(0, FUSION_DEPTH), semantic.slice(0, FUSION_DEPTH)]) : lexical;
  } else {
    ranked = (semantic ?? []).filter((r) => r.score >= MIN_SIMILARITY);
  }
  return ranked.slice(0, MAX_CHUNKS).map((r) => r.chunk);
}

/**
 * セッションを作ったとき（ユーザーがシオリの問いかけに答える前）に、外部の知識源を取ってきて
 * 段落の埋め込みを裏で作り始める。最初の答えを待たせないため。失敗しても何もしない。
 */
export function prepareTopicSearch(workId: string): void {
  if (getSources(workId).length === 0) return;
  void loadSourceChunks(workId)
    .then((chunks) => ensureChunkEmbeddings(workId, chunks))
    .catch((error) => console.error("話題の検索の準備に失敗:", error));
}

/** 同じ場面を指しているか（切り替えたつもりで同じ場面を引き直したときは、切り替えとみなさない） */
/**
 * 話題の場面の資料（`topic.chunkIds` の段落）を、主張の照合用の節に分ける。
 * 資料係が事実に要約しなかった細部も本物の設定として照合できるようにするためのもので、
 * grounding（本当か嘘かの判定）にだけ使い、生成には渡さない。段落は sources.ts のキャッシュから引く。
 * 取れなければ空（照合が事実だけになるだけで、会話は止めない）。
 */
export async function topicSourceClauses(workId: string, topic: SessionTopic, normalize: Normalizer): Promise<SourceClause[]> {
  const ids = new Set(topic.chunkIds ?? []);
  if (ids.size === 0) return [];
  try {
    const chunks = (await loadSourceChunks(workId)).filter((c) => ids.has(c.id));
    return sourceClauses(chunks, (text) => mentionedNames(workId, text), normalize);
  } catch (error) {
    console.warn("話題の資料を照合用に読めませんでした:", error);
    return [];
  }
}

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
    // 言い換えや曖昧な言い方に強いベクトル検索（ベクトルDB）。段落の埋め込みがまだ1件も無ければ bigram だけ
    const semantic = await rankChunksByVector(workId, query, chunks, FUSION_DEPTH);
    const candidates = selectCandidates(lexical, semantic);
    // 挨拶のように、文字でも意味でも資料とほとんど重ならない発話では資料係を呼ばない
    if (candidates.length === 0) return null;

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
