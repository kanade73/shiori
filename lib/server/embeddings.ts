import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { ai, EMBEDDING_MODEL } from "./llm/client";
import { dataDir } from "./store";
import type { SourceChunk } from "./types";

/**
 * 外部資料の段落のベクトル検索（issue #14 の続き）。文字 bigram では拾えない言い換え
 * （「ラーメン屋に入れなかった」→『郎』編）を補う。
 *
 * ベクトルDBは入れない（AGENTS.md）。段落は1記事で百数十件なので、ベクトルはメモリに持ち、
 * 再起動をまたいで埋め込み直さないよう DATA_DIR に JSON で残すだけにする。
 * シオリに渡す文脈の量は変わらない（選ぶ段落の数は同じで、渡すのは資料係が要約した事実だけ）。
 *
 * 無料枠の埋め込みは「1分あたり100件」で、まとめて送っても1件ずつ数えられる。記事の段落を
 * 一度に埋め込むと枠を超えるので、段落の埋め込みは裏で1分ごとに分けて作り、揃うまでは
 * ベクトル検索をせず bigram だけで答える（会話は待たせない）。
 */

const DIMENSIONS = 768;
/** 1分あたりに段落を埋め込む数。検索語の埋め込み（1件）の分を残しておく */
const BATCH_SIZE = 80;
const BATCH_INTERVAL_MS = 61_000;

type Vector = number[];

let memory: Map<string, Vector> | null = null;

function cacheFile(): string {
  return path.join(dataDir(), "embeddings", `${EMBEDDING_MODEL}-${DIMENSIONS}.json`);
}

function loadCache(): Map<string, Vector> {
  if (memory) return memory;
  memory = new Map();
  try {
    const raw = JSON.parse(fs.readFileSync(cacheFile(), "utf-8")) as Record<string, Vector>;
    for (const [key, vector] of Object.entries(raw)) memory.set(key, vector);
  } catch {
    // まだ無い・壊れている。埋め込み直す
  }
  return memory;
}

function saveCache(cache: Map<string, Vector>) {
  try {
    fs.mkdirSync(path.dirname(cacheFile()), { recursive: true });
    fs.writeFileSync(cacheFile(), JSON.stringify(Object.fromEntries(cache)), "utf-8");
  } catch (error) {
    console.error("埋め込みのキャッシュの保存に失敗:", error);
  }
}

let job: Promise<void> | null = null;

/** テスト用 */
export function clearEmbeddingCache() {
  memory = null;
  job = null;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function keyOf(chunk: SourceChunk): string {
  return createHash("sha1").update(`${chunk.label}\n${chunk.text}`).digest("hex");
}

function round(vector: Vector): Vector {
  // JSON を小さくするため。検索の順位には効かない程度の丸め
  return vector.map((v) => Math.round(v * 1e5) / 1e5);
}

async function embed(texts: string[], taskType: "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY"): Promise<Vector[]> {
  const res = await ai.models.embedContent({
    model: EMBEDDING_MODEL,
    contents: texts,
    config: { taskType, outputDimensionality: DIMENSIONS },
  });
  const got = res.embeddings ?? [];
  if (got.length !== texts.length) throw new Error(`embedding count mismatch: ${got.length} / ${texts.length}`);
  return got.map((e) => round(e.values ?? []));
}

/**
 * まだ埋め込んでいない段落を、裏で1分ごとに BATCH_SIZE 件ずつ埋め込む。既に動いていれば何もしない。
 * 1回分が終わるたびにキャッシュを保存するので、途中で落ちても続きからになる。
 */
export function ensureChunkEmbeddings(chunks: SourceChunk[]): Promise<void> {
  if (job) return job;
  const cache = loadCache();
  const missing = chunks.filter((c) => !cache.has(keyOf(c)));
  if (missing.length === 0) return Promise.resolve();

  job = (async () => {
    try {
      for (let i = 0; i < missing.length; i += BATCH_SIZE) {
        if (i > 0) await sleep(BATCH_INTERVAL_MS);
        const batch = missing.slice(i, i + BATCH_SIZE);
        const vectors = await embed(
          batch.map((c) => `${c.label}\n${c.text}`),
          "RETRIEVAL_DOCUMENT",
        );
        batch.forEach((c, j) => cache.set(keyOf(c), vectors[j]));
        saveCache(cache);
      }
    } catch (error) {
      console.error("段落の埋め込みに失敗（次に検索するときにまた続きから作る）:", error);
    } finally {
      job = null;
    }
  })();
  return job;
}

function cosine(a: Vector, b: Vector): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na === 0 || nb === 0 ? 0 : dot / Math.sqrt(na * nb);
}

/**
 * 検索語と段落のコサイン類似度で段落を並べる。段落の埋め込みがまだ揃っていなければ、裏で作り始めて
 * null を返す（呼び出し側は bigram だけで続ける）。検索語の埋め込みに失敗したときも null。
 */
export async function rankChunksByVector(query: string, chunks: SourceChunk[]): Promise<{ chunk: SourceChunk; score: number }[] | null> {
  if (chunks.length === 0 || !query.trim()) return [];
  const cache = loadCache();
  if (chunks.some((c) => !cache.has(keyOf(c)))) {
    void ensureChunkEmbeddings(chunks);
    return null;
  }
  try {
    const [queryVector] = await embed([query], "RETRIEVAL_QUERY");
    return chunks
      .map((chunk) => ({ chunk, score: cosine(queryVector, cache.get(keyOf(chunk))!) }))
      .sort((a, b) => b.score - a.score);
  } catch (error) {
    console.error("段落のベクトル検索に失敗（bigram だけで続ける）:", error);
    return null;
  }
}
