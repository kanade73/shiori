import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { SourceChunk } from "./types";

// 段落のベクトル検索。埋め込み API は差し替え、キャッシュは一時ディレクトリに書く
const { embedContent } = vi.hoisted(() => ({ embedContent: vi.fn() }));
vi.mock("./llm/client", () => ({ ai: { models: { embedContent } }, EMBEDDING_MODEL: "test-embedding" }));

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "embeddings-"));
let mod: typeof import("./embeddings");

beforeAll(async () => {
  process.env.DATA_DIR = dir;
  mod = await import("./embeddings");
});

afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function chunk(id: string, text: string): SourceChunk {
  return { id, sourceTitle: "記事", url: "u", heading: "", label: "", text };
}

// 文ごとに決まった向きのベクトルを返す: 「ラーメン」を含めば x 軸、「検定」なら y 軸
function vectorOf(text: string): number[] {
  if (text.includes("ラーメン")) return [1, 0];
  if (text.includes("検定")) return [0, 1];
  return [0.5, 0.5];
}

beforeEach(() => {
  mod.clearEmbeddingCache();
  fs.rmSync(path.join(dir, "embeddings"), { recursive: true, force: true });
  embedContent.mockReset();
  embedContent.mockImplementation(async ({ contents }: { contents: string[] }) => ({
    embeddings: contents.map((text) => ({ values: vectorOf(text) })),
  }));
});

const chunks = [chunk("a", "ラーメン店に入れない"), chunk("b", "草むしり検定を受ける"), chunk("c", "リボン")];

describe("rankChunksByVector", () => {
  it("段落の埋め込みが揃っていなければ、裏で作り始めて null（会話は待たせず bigram だけで続ける）", async () => {
    expect(await mod.rankChunksByVector("ラーメン屋", chunks)).toBeNull();
    // 裏の埋め込みは段落のために1回（検索語の分はまだ呼んでいない）
    expect(embedContent).toHaveBeenCalledTimes(1);
    expect(embedContent.mock.calls[0][0].config.taskType).toBe("RETRIEVAL_DOCUMENT");
  });

  it("揃ったら検索語を埋め込み、コサイン類似度の高い順に並べる", async () => {
    await mod.ensureChunkEmbeddings(chunks);
    const ranked = await mod.rankChunksByVector("ラーメン屋さん", chunks);
    expect(ranked?.map((r) => r.chunk.id)).toEqual(["a", "c", "b"]);
    expect(embedContent.mock.lastCall![0].config.taskType).toBe("RETRIEVAL_QUERY");
  });

  it("埋め込みは DATA_DIR に残り、再起動後（メモリを消しても）埋め込み直さない", async () => {
    await mod.ensureChunkEmbeddings(chunks);
    expect(fs.existsSync(path.join(dir, "embeddings", "test-embedding-768.json"))).toBe(true);
    mod.clearEmbeddingCache();
    embedContent.mockClear();
    await mod.rankChunksByVector("検定", chunks);
    // 検索語の1回だけ
    expect(embedContent).toHaveBeenCalledTimes(1);
  });

  it("無料枠（1分100件）を超えないよう、段落は80件ずつ1分おきに埋め込む", async () => {
    vi.useFakeTimers();
    try {
      const many = Array.from({ length: 170 }, (_, i) => chunk(`m${i}`, `段落${i}`));
      const job = mod.ensureChunkEmbeddings(many);
      await vi.advanceTimersByTimeAsync(0);
      expect(embedContent).toHaveBeenCalledTimes(1);
      expect(embedContent.mock.calls[0][0].contents).toHaveLength(80);
      await vi.advanceTimersByTimeAsync(61_000);
      expect(embedContent).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(61_000);
      await job;
      expect(embedContent.mock.calls.map((c) => c[0].contents.length)).toEqual([80, 80, 10]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("検索語の埋め込みに失敗したら null", async () => {
    await mod.ensureChunkEmbeddings(chunks);
    embedContent.mockRejectedValue(new Error("429"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await mod.rankChunksByVector("検定", chunks)).toBeNull();
    spy.mockRestore();
  });
});
