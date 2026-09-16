import { createHash } from "node:crypto";
import { ai, EMBEDDING_MODEL } from "./llm/client";
import { supabase, unwrap } from "./supabase";
import type { SourceChunk } from "./types";

/**
 * 外部資料の段落のベクトル検索（issue #14 の続き）。文字 bigram では拾えない言い換え
 * （「ラーメン屋に入れなかった」→『郎』編）や、固有名詞の無い曖昧な言い方（「泣ける話」）を補う。
 *
 * **段落の埋め込みを作るのは実行時ではなく `scripts/embed-chunks.ts`（オフライン）**。
 * サーバーレスでは「応答を返した後も1分おきに埋め込み続ける」裏の仕事が成立しないため、
 * 文書側は事前に Supabase（source_chunks）へ入れておき、実行時は
 * 「検索語を1件埋め込む → pgvector で近傍を引く」だけにしてある。
 *
 * まだ1件も入っていなければ null を返し、呼び出し側は文字 bigram だけで検索する（会話は止まらない）。
 */

/** 埋め込みの次元。supabase/schema.sql の vector(768) と一致していること */
export const DIMENSIONS = 768;

export type VectorRankedChunk = { chunk: SourceChunk; score: number };

/** 段落の識別子。本文が1文字でも変われば別の段落になる（scripts/embed-chunks.ts と共有） */
export function chunkKey(chunk: SourceChunk): string {
  return createHash("sha1").update(`${chunk.label}\n${chunk.text}`).digest("hex");
}

/** 埋め込みに渡す文字列。見出しを本文の前に付ける（scripts/embed-chunks.ts と共有） */
export function chunkDocument(chunk: SourceChunk): string {
  return `${chunk.label}\n${chunk.text}`;
}

export async function embedTexts(
  texts: string[],
  taskType: "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY",
): Promise<number[][]> {
  const res = await ai.models.embedContent({
    model: EMBEDDING_MODEL,
    contents: texts,
    config: { taskType, outputDimensionality: DIMENSIONS },
  });
  const got = res.embeddings ?? [];
  if (got.length !== texts.length) throw new Error(`embedding count mismatch: ${got.length} / ${texts.length}`);
  return got.map((e) => e.values ?? []);
}

/** この作品の段落が1件でも埋め込まれているか（検索語の埋め込みを無駄打ちしないための確認） */
async function hasEmbeddedChunks(workId: string): Promise<boolean> {
  const { count, error } = await supabase()
    .from("source_chunks")
    .select("chunk_key", { count: "exact", head: true })
    .eq("work_id", workId)
    .eq("model", EMBEDDING_MODEL);
  if (error) throw new Error(`段落の件数の取得に失敗: ${error.message}`);
  return (count ?? 0) > 0;
}

/**
 * 検索語に近い段落を、コサイン類似度（score）の高い順に最大 `limit` 件。
 * 段落が1件も埋め込まれていないとき、検索語の埋め込みや DB の検索に失敗したときは null
 * （呼び出し側は bigram だけで続ける）。
 */
export async function rankChunksByVector(
  workId: string,
  query: string,
  chunks: SourceChunk[],
  limit = chunks.length,
): Promise<VectorRankedChunk[] | null> {
  if (chunks.length === 0 || !query.trim()) return [];
  try {
    if (!(await hasEmbeddedChunks(workId))) return null;

    const [queryVector] = await embedTexts([query], "RETRIEVAL_QUERY");
    // 記事が書き換わった後は、DB に残っている古い段落が混ざる。落とす分を見込んで多めに引く
    // （埋め込みを作り直すまでの一時的なずれ。scripts/embed-chunks.ts を流せば揃う）
    const rows = unwrap(
      await supabase().rpc("match_source_chunks", {
        p_work_id: workId,
        p_model: EMBEDDING_MODEL,
        p_query: queryVector,
        p_k: limit * 2 + 10,
      }),
      "段落のベクトル検索に失敗",
    ) as { chunk_key: string; similarity: number }[];

    const current = new Map(chunks.map((c) => [chunkKey(c), c]));
    return rows
      .flatMap(({ chunk_key, similarity }) => {
        const chunk = current.get(chunk_key);
        return chunk ? [{ chunk, score: similarity }] : [];
      })
      .slice(0, limit);
  } catch (error) {
    console.error("段落のベクトル検索に失敗（bigram だけで続ける）:", error);
    return null;
  }
}
