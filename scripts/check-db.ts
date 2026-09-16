/**
 * Supabase の準備ができているかを確かめる。
 *
 *   npm run db:check
 *
 * supabase/schema.sql を流した後に1回。テーブルと近傍探索の SQL 関数が
 * PostgREST から見えているかを見るだけで、何も書き込まない。
 */
import { loadEnvConfig } from "@next/env";

const TABLES = [
  "sessions",
  "messages",
  "message_claims",
  "fabricated_facts",
  "fabricated_relations",
  "source_chunks",
  "creator_profiles",
];

async function main() {
  loadEnvConfig(process.cwd());
  const { supabase } = await import("../lib/server/supabase");

  let ng = 0;
  for (const table of TABLES) {
    const { count, error } = await supabase().from(table).select("*", { count: "exact", head: true });
    if (error) ng++;
    console.log(`${table.padEnd(22)} ${error ? `NG: ${error.message}` : `OK（${count ?? 0} 行）`}`);
  }

  // 近傍探索の SQL 関数。テーブルだけ作って関数を流し忘れると、ベクトル検索が丸ごと効かない
  const { error } = await supabase().rpc("match_source_chunks", {
    p_work_id: "__check__",
    p_model: "__check__",
    p_query: new Array(768).fill(0),
    p_k: 1,
  });
  if (error) ng++;
  console.log(`${"match_source_chunks".padEnd(22)} ${error ? `NG: ${error.message}` : "OK"}`);

  if (ng > 0) {
    console.error(`\n${ng} 件 NG。supabase/schema.sql を SQL Editor で流し直し、最後に notify pgrst, 'reload schema'; を実行すること`);
    process.exit(1);
  }
  console.log("\nすべて OK");
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
