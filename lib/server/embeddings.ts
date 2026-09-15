import { createHash } from "node:crypto";
import { ai, EMBEDDING_MODEL } from "./llm/client";
import { closeVectorDb, vectorDb } from "./vector-db";
import type { SourceChunk } from "./types";

/**
 * 外部資料の段落のベクトル検索（issue #14 の続き、issue #22 でベクトルDBに移した）。文字 bigram
 * では拾えない言い換え（「ラーメン屋に入れなかった」→『郎』編）や、固有名詞の無い曖昧な言い方
 * （「泣ける話」）を補う。段落の埋め込みと近傍の探索は vector-db.ts（sqlite-vec）が持つ。
 * シオリに渡す文脈の量は変わらない（資料係に渡す段落は最大8件のままで、シオリに渡るのは資料係が要約した事実だけ）。
 *
 * 無料枠の埋め込みは「1分あたり100件」で、まとめて送っても1件ずつ数えられる。記事の段落を
 * 一度に埋め込むと枠を超えるので、段落の埋め込みは裏で1分ごとに分けて作る。埋め込み済みの
 * 段落が1件でもあればその中で探し、まだ1件も無ければ bigram だけで答える（会話は待たせない）。
 */

const DIMENSIONS = 768;
/** 1分あたりに段落を埋め込む数。検索語の埋め込み（1件）の分を残しておく */
const BATCH_SIZE = 80;
const BATCH_INTERVAL_MS = 61_000;

export type VectorRankedChunk = { chunk: SourceChunk; score: number };

/**
 * 作品ごとの、段落を埋め込んでいる裏の仕事。Next の本番ビルドではルートごとにこのモジュールが別々に
 * 読み込まれることがあり、セッション作成（prepareTopicSearch）とメッセージの Route Handler が同じ段落を
 * 二重に埋め込むと無料枠（1分100件）を超えるので、プロセスで1つにするため globalThis に置く
 */
const shared = globalThis as typeof globalThis & { __embeddingJobs?: Map<string, Promise<void>> };
const jobs = (shared.__embeddingJobs ??= new Map<string, Promise<void>>());

/** テスト用（プロセスの再起動の代わり） */
export function clearEmbeddingCache() {
  closeVectorDb();
  jobs.clear();
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function keyOf(chunk: SourceChunk): string {
  return createHash("sha1").update(`${chunk.label}\n${chunk.text}`).digest("hex");
}

function documentOf(chunk: SourceChunk): string {
  return `${chunk.label}\n${chunk.text}`;
}

async function embed(texts: string[], taskType: "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY"): Promise<number[][]> {
  const res = await ai.models.embedContent({
    model: EMBEDDING_MODEL,
    contents: texts,
    config: { taskType, outputDimensionality: DIMENSIONS },
  });
  const got = res.embeddings ?? [];
  if (got.length !== texts.length) throw new Error(`embedding count mismatch: ${got.length} / ${texts.length}`);
  return got.map((e) => e.values ?? []);
}

function store() {
  return vectorDb(EMBEDDING_MODEL, DIMENSIONS);
}

/**
 * まだ埋め込んでいない段落を、裏で1分ごとに BATCH_SIZE 件ずつ埋め込んで DB に入れる。
 * その作品で既に動いていれば何もしない。1回分ずつ DB に書くので、途中で落ちても続きからになる。
 * 記事が書き換わってもう無い段落は、ここで DB から消す。
 */
export function ensureChunkEmbeddings(workId: string, chunks: SourceChunk[]): Promise<void> {
  const running = jobs.get(workId);
  if (running) return running;

  let missing: SourceChunk[];
  try {
    const db = store();
    const current = new Map(chunks.map((c) => [keyOf(c), c]));
    db.removeExcept(workId, new Set(current.keys()));
    const have = db.keys(workId);
    missing = [...current.entries()].filter(([key]) => !have.has(key)).map(([, c]) => c);
  } catch (error) {
    console.error("ベクトルDBを開けない（bigram だけで続ける）:", error);
    return Promise.resolve();
  }
  if (missing.length === 0) return Promise.resolve();
  console.info(`[embeddings] ${workId}: 段落 ${missing.length} 件を埋め込み始める（1分 ${BATCH_SIZE} 件ずつ）`);

  const job = (async () => {
    try {
      for (let i = 0; i < missing.length; i += BATCH_SIZE) {
        if (i > 0) await sleep(BATCH_INTERVAL_MS);
        const batch = missing.slice(i, i + BATCH_SIZE);
        const vectors = await embed(batch.map(documentOf), "RETRIEVAL_DOCUMENT");
        store().add(
          workId,
          batch.map((c, j) => ({ key: keyOf(c), label: c.label, text: c.text, embedding: vectors[j] })),
        );
      }
    } catch (error) {
      console.error("段落の埋め込みに失敗（次に検索するときにまた続きから作る）:", error);
    } finally {
      jobs.delete(workId);
    }
  })();
  jobs.set(workId, job);
  return job;
}

/**
 * 検索語に近い段落を、コサイン類似度（score）の高い順に最大 `limit` 件。
 * 埋め込んでいない段落があれば裏で作り始め、埋め込み済みの段落の中だけで探す。
 * 1件も埋め込まれていないとき、DB や検索語の埋め込みに失敗したときは null（呼び出し側は bigram だけで続ける）。
 */
export async function rankChunksByVector(
  workId: string,
  query: string,
  chunks: SourceChunk[],
  limit = chunks.length,
): Promise<VectorRankedChunk[] | null> {
  if (chunks.length === 0 || !query.trim()) return [];
  try {
    const current = new Map(chunks.map((c) => [keyOf(c), c]));
    const have = store().keys(workId);
    const embedded = [...current.keys()].filter((key) => have.has(key)).length;
    if (embedded < current.size) void ensureChunkEmbeddings(workId, chunks);
    if (embedded === 0) return null;

    const [queryVector] = await embed([query], "RETRIEVAL_QUERY");
    // 記事が書き換わった直後は古い段落が DB に残っていることがあるので、その分も多めに引いて落とす
    const stale = have.size - embedded;
    return store()
      .nearest(workId, queryVector, Math.min(have.size, limit + stale))
      .flatMap(({ key, similarity }) => {
        const chunk = current.get(key);
        return chunk ? [{ chunk, score: similarity }] : [];
      })
      .slice(0, limit);
  } catch (error) {
    console.error("段落のベクトル検索に失敗（bigram だけで続ける）:", error);
    return null;
  }
}
