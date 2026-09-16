import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Supabase（Postgres + pgvector）への口。セッション・発話・嘘・主張（store.ts）、
 * 外部資料の段落の埋め込み（embeddings.ts）、作り手の作風（creator.ts）がここを通る。
 *
 * 使うのは service_role キー。全テーブルが RLS 有効・ポリシー無しなので、
 * このキーを持つサーバー側だけが読み書きできる（supabase/schema.sql）。
 * `NEXT_PUBLIC_` には絶対に置かないこと。client から import するのも禁止。
 */

// Next の本番ビルドではルートごとにモジュールが別々に読み込まれることがある。
// 接続（とその HTTP keep-alive）はプロセスで1本にしたいので globalThis に置く
const shared = globalThis as typeof globalThis & { __supabase?: SupabaseClient };

export function supabase(): SupabaseClient {
  if (shared.__supabase) return shared.__supabase;

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "SUPABASE_URL と SUPABASE_SERVICE_ROLE_KEY が要る（.env.local か Vercel の環境変数に入れる）",
    );
  }

  shared.__supabase = createClient(url, key, {
    // サーバー専用。ログイン状態を持たないし、トークンの自動更新も要らない
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return shared.__supabase;
}

/** テスト用（プロセスの再起動の代わり） */
export function resetSupabaseClient() {
  delete shared.__supabase;
}

/**
 * PostgREST の `{ data, error }` を開く。失敗は握りつぶさず投げる
 * （呼び出し側の Route Handler が 500 を返し、原因がログに出る）。
 */
export function unwrap<T>(result: { data: T; error: { message: string } | null }, what: string): T {
  if (result.error) throw new Error(`${what}: ${result.error.message}`);
  return result.data;
}
