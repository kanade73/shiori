import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import * as sqliteVec from "sqlite-vec";
import { dataDir } from "./store";

/**
 * 外部資料の段落のベクトルDB（issue #22）。SQLite に sqlite-vec の拡張を読み込み、
 * `DATA_DIR/vectors/` のファイル1本に段落の埋め込みを持つ。近傍の探索は DB の中でする。
 *
 * サーバーを別に立てず（Route Handler と同じプロセス）、Fly のボリュームにそのまま載る
 * 組み込み型を選んだ。段落は作品ごとの区画（partition key）に分けて持つ。
 * 埋め込みのモデルや次元が変わるとベクトルの向きが揃わないので、ファイルを分ける。
 */

export type StoredChunk = { key: string; label: string; text: string; embedding: number[] };
export type Neighbor = { key: string; similarity: number };

// Next の本番ビルドではルートごとにこのモジュールが別々に読み込まれることがある（セッション作成と
// メッセージの Route Handler で別のインスタンス）。接続はプロセスで1本にしたいので globalThis に置く
const shared = globalThis as typeof globalThis & { __vectorDb?: { conn: DatabaseSync; file: string } };

function toBlob(vector: number[]): Uint8Array {
  return new Uint8Array(new Float32Array(vector).buffer);
}

function open(file: string, dimensions: number): DatabaseSync {
  if (shared.__vectorDb?.file === file) return shared.__vectorDb.conn;
  shared.__vectorDb?.conn.close();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const conn = new DatabaseSync(file, { allowExtension: true });
  sqliteVec.load(conn);
  // 読み込んだら、以後 SQL から任意の拡張を読めないよう閉じておく
  conn.enableLoadExtension(false);
  conn.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS chunk_vectors USING vec0(
    chunk_key TEXT PRIMARY KEY,
    work_id TEXT PARTITION KEY,
    embedding FLOAT[${dimensions}] distance_metric=cosine,
    +label TEXT,
    +text TEXT
  )`);
  shared.__vectorDb = { conn, file };
  return conn;
}

export function vectorDb(model: string, dimensions: number) {
  const conn = open(path.join(dataDir(), "vectors", `${model}-${dimensions}.sqlite`), dimensions);

  /** この作品について埋め込み済みの段落のキー */
  const keys = (workId: string): Set<string> => {
    const rows = conn.prepare("SELECT chunk_key FROM chunk_vectors WHERE work_id = ?").all(workId);
    return new Set(rows.map((r) => String(r.chunk_key)));
  };

  return {
    keys,

    /** 段落の埋め込みを入れる。既に入っている段落は飛ばす（vec0 には INSERT OR IGNORE が無い） */
    add(workId: string, chunks: StoredChunk[]) {
      const exists = conn.prepare("SELECT 1 FROM chunk_vectors WHERE chunk_key = ?");
      const insert = conn.prepare(
        "INSERT INTO chunk_vectors(chunk_key, work_id, embedding, label, text) VALUES (?, ?, ?, ?, ?)",
      );
      conn.exec("BEGIN");
      try {
        for (const c of chunks) {
          if (!exists.get(c.key)) insert.run(c.key, workId, toBlob(c.embedding), c.label, c.text);
        }
        conn.exec("COMMIT");
      } catch (error) {
        conn.exec("ROLLBACK");
        throw error;
      }
    },

    /** 記事が書き換わって、もう無い段落の埋め込みを消す */
    removeExcept(workId: string, keep: Set<string>): number {
      const stale = [...keys(workId)].filter((k) => !keep.has(k));
      const remove = conn.prepare("DELETE FROM chunk_vectors WHERE chunk_key = ?");
      for (const key of stale) remove.run(key);
      return stale.length;
    },

    /** 検索語のベクトルに近い段落を、コサイン類似度の高い順に k 件 */
    nearest(workId: string, query: number[], k: number): Neighbor[] {
      if (k <= 0) return [];
      const rows = conn
        .prepare(
          "SELECT chunk_key, distance FROM chunk_vectors WHERE embedding MATCH ? AND k = ? AND work_id = ? ORDER BY distance",
        )
        .all(toBlob(query), k, workId);
      return rows.map((r) => ({ key: String(r.chunk_key), similarity: 1 - Number(r.distance) }));
    },
  };
}

/** テスト用（プロセスの再起動の代わり）。接続を閉じ、次に使うときに開き直す */
export function closeVectorDb() {
  shared.__vectorDb?.conn.close();
  delete shared.__vectorDb;
}
