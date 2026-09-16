/**
 * supabase/schema.sql を Supabase の Postgres に流す。
 *
 *   npm run db:push
 *
 * schema.sql は何度流しても壊れないように書いてあるので、スキーマを変えたら流し直せばよい。
 * ダッシュボードの SQL Editor に貼るのと同じことを手元からやるためのもの。
 *
 * **service_role キー（PostgREST）では DDL を流せない**ので、ここだけは Postgres に直接つなぐ。
 * `SUPABASE_DB_URL` に接続文字列が要る（ダッシュボードの Connect → Session pooler の URI。
 * ポート 5432 の方。IPv4 で繋がるのは pooler なので、db.<ref>.supabase.co の直結ではなくこちら）。
 */
import fs from "node:fs";
import path from "node:path";
import { loadEnvConfig } from "@next/env";
import { Client } from "pg";

async function main() {
  loadEnvConfig(process.cwd());

  const connectionString = process.env.SUPABASE_DB_URL;
  if (!connectionString) {
    throw new Error(
      "SUPABASE_DB_URL が要る（ダッシュボードの Connect → Session pooler の URI を .env.local に）",
    );
  }

  const file = path.join(process.cwd(), "supabase", "schema.sql");
  const sql = fs.readFileSync(file, "utf-8");

  // Supabase は SSL 必須。pooler の証明書はチェーンを辿れないので検証は外す
  const client = new Client({ connectionString, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    await client.query(sql);
    console.info(`supabase/schema.sql を流した（${sql.split("\n").length} 行）`);
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
