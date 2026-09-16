/**
 * 外部資料の段落の埋め込みを作って Supabase（source_chunks）に入れる。**オフラインで流すもの**。
 *
 *   npm run embed            # data/ の全作品
 *   npm run embed chiikawa   # 作品を指定
 *
 * サーバーレスでは「応答を返した後も1分おきに埋め込み続ける」裏の仕事が成立しないので、
 * 文書側の埋め込みはここで事前に作る。実行時（lib/server/embeddings.ts）は検索語を
 * 1件埋め込んで pgvector を引くだけ。記事はめったに変わらないので、デプロイ前に一度流せばよい。
 *
 * 埋め込みの無料枠は「1分あたり100件（まとめて送っても1件ずつ数える）」なので、
 * 80件ずつ1分おきに送る。記事が書き換わってもう無い段落は、ここで DB から消す。
 *
 * 必要な環境変数は .env.local の GEMINI_API_KEY / SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY。
 */
import { loadEnvConfig } from "@next/env";

/** 1分あたりに送る段落の数（無料枠 100 件のうち、手元の試し打ちの分を少し残す） */
const BATCH_SIZE = 80;
const BATCH_INTERVAL_MS = 61_000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  loadEnvConfig(process.cwd());

  // 環境変数を読んでから、それを見るモジュールを読み込む（client.ts はモジュールの読み込み時にキーを掴む）
  const { EMBEDDING_MODEL } = await import("../lib/server/llm/client");
  const { chunkDocument, chunkKey, embedTexts } = await import("../lib/server/embeddings");
  const { supabase, unwrap } = await import("../lib/server/supabase");
  const { loadSourceChunks } = await import("../lib/server/sources");
  const { listWorks } = await import("../lib/server/works");

  async function embedWork(workId: string): Promise<void> {
    const chunks = await loadSourceChunks(workId);
    if (chunks.length === 0) {
      console.info(`[${workId}] 外部の知識源が無い（work.json の sources が空）。飛ばす`);
      return;
    }

    const current = new Map(chunks.map((c) => [chunkKey(c), c]));
    const rows = unwrap(
      await supabase().from("source_chunks").select("chunk_key").eq("work_id", workId).eq("model", EMBEDDING_MODEL),
      "埋め込み済みの段落の取得に失敗",
    ) as { chunk_key: string }[];
    const have = new Set(rows.map((r) => r.chunk_key));

    const stale = [...have].filter((key) => !current.has(key));
    if (stale.length > 0) {
      const { error } = await supabase().from("source_chunks").delete().in("chunk_key", stale);
      if (error) throw new Error(`もう無い段落の削除に失敗: ${error.message}`);
      console.info(`[${workId}] 記事から消えた段落 ${stale.length} 件を DB から削除`);
    }

    const missing = [...current.entries()].filter(([key]) => !have.has(key));
    if (missing.length === 0) {
      console.info(`[${workId}] 段落 ${chunks.length} 件はすべて埋め込み済み`);
      return;
    }

    const batches = Math.ceil(missing.length / BATCH_SIZE);
    console.info(`[${workId}] 段落 ${missing.length} 件を埋め込む（${BATCH_SIZE} 件 × ${batches} 回、1分おき）`);

    for (let i = 0; i < missing.length; i += BATCH_SIZE) {
      if (i > 0) {
        console.info(`[${workId}] 無料枠のため 61 秒待つ…`);
        await sleep(BATCH_INTERVAL_MS);
      }
      const batch = missing.slice(i, i + BATCH_SIZE);
      const vectors = await embedTexts(
        batch.map(([, chunk]) => chunkDocument(chunk)),
        "RETRIEVAL_DOCUMENT",
      );
      const updatedAt = new Date().toISOString();
      const { error } = await supabase()
        .from("source_chunks")
        .upsert(
          batch.map(([key, chunk], j) => ({
            chunk_key: key,
            work_id: workId,
            label: chunk.label,
            text: chunk.text,
            model: EMBEDDING_MODEL,
            embedding: vectors[j],
            updated_at: updatedAt,
          })),
        );
      if (error) throw new Error(`段落の保存に失敗: ${error.message}`);
      console.info(`[${workId}] ${Math.min(i + BATCH_SIZE, missing.length)} / ${missing.length} 件`);
    }
  }

  const requested = process.argv.slice(2);
  const workIds = requested.length > 0 ? requested : listWorks().map((w) => w.id);
  if (workIds.length === 0) {
    throw new Error("作品が無い（data/<workId>/work.json を置くこと）");
  }

  for (const workId of workIds) {
    await embedWork(workId);
  }
  console.info("完了");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
