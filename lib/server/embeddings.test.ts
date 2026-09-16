import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SourceChunk } from "./types";

// 段落のベクトル検索。埋め込み API と Supabase（pgvector）を差し替えて、
// 「検索語を1件埋め込む → 近傍を引く → いまの段落だけに絞る」を確かめる。
// 段落そのものの埋め込みは実行時には作らない（scripts/embed-chunks.ts の仕事）。
const { embedContent } = vi.hoisted(() => ({ embedContent: vi.fn() }));
vi.mock("./llm/client", () => ({ ai: { models: { embedContent } }, EMBEDDING_MODEL: "test-embedding" }));

const { state } = vi.hoisted(() => ({
  state: { count: 0, rows: [] as { chunk_key: string; similarity: number }[], rpc: vi.fn(), failCount: false },
}));

vi.mock("./supabase", async () => {
  const actual = await vi.importActual<typeof import("./supabase")>("./supabase");
  return {
    ...actual,
    supabase: () => ({
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: async () => (state.failCount ? { count: null, error: { message: "boom" } } : { count: state.count, error: null }),
          }),
        }),
      }),
      rpc: state.rpc,
    }),
  };
});

import { chunkKey, rankChunksByVector } from "./embeddings";

function chunk(id: string, text: string): SourceChunk {
  return { id, sourceTitle: "記事", url: "u", heading: "", label: "", text };
}

const chunks = [chunk("a", "ラーメン店に入れない"), chunk("b", "草むしり検定を受ける"), chunk("c", "リボン")];
const key = (id: string) => chunkKey(chunks.find((c) => c.id === id)!);

beforeEach(() => {
  embedContent.mockReset();
  embedContent.mockImplementation(async ({ contents }: { contents: string[] }) => ({
    embeddings: contents.map(() => ({ values: new Array(768).fill(0.1) })),
  }));
  state.count = chunks.length;
  state.failCount = false;
  state.rpc = vi.fn(async () => ({ data: state.rows, error: null }));
});

describe("rankChunksByVector", () => {
  it("段落が1件も埋め込まれていなければ null（検索語の埋め込みも使わず、bigram だけで続ける）", async () => {
    state.count = 0;
    expect(await rankChunksByVector("w", "ラーメン屋", chunks)).toBeNull();
    expect(embedContent).not.toHaveBeenCalled();
    expect(state.rpc).not.toHaveBeenCalled();
  });

  it("検索語を1件だけ埋め込み、pgvector の近い順（コサイン類似度）をそのまま返す", async () => {
    state.rows = [
      { chunk_key: key("a"), similarity: 0.91 },
      { chunk_key: key("c"), similarity: 0.42 },
    ];
    const ranked = await rankChunksByVector("w", "ラーメン屋さん", chunks);

    expect(ranked?.map((r) => r.chunk.id)).toEqual(["a", "c"]);
    expect(ranked?.[0].score).toBeCloseTo(0.91);
    expect(embedContent).toHaveBeenCalledTimes(1);
    expect(embedContent.mock.calls[0][0].config.taskType).toBe("RETRIEVAL_QUERY");
    expect(state.rpc.mock.calls[0][0]).toBe("match_source_chunks");
    expect(state.rpc.mock.calls[0][1]).toMatchObject({ p_work_id: "w", p_model: "test-embedding" });
  });

  it("limit で上位だけ返す", async () => {
    state.rows = [
      { chunk_key: key("b"), similarity: 0.8 },
      { chunk_key: key("a"), similarity: 0.7 },
    ];
    expect((await rankChunksByVector("w", "検定", chunks, 1))?.map((r) => r.chunk.id)).toEqual(["b"]);
  });

  it("記事が書き換わって DB にだけ残っている段落は落とす", async () => {
    state.rows = [
      { chunk_key: "もう記事に無い段落のキー", similarity: 0.99 },
      { chunk_key: key("b"), similarity: 0.5 },
    ];
    expect((await rankChunksByVector("w", "検定", chunks))?.map((r) => r.chunk.id)).toEqual(["b"]);
  });

  it("検索語の埋め込みに失敗したら null", async () => {
    embedContent.mockRejectedValue(new Error("429"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await rankChunksByVector("w", "検定", chunks)).toBeNull();
    spy.mockRestore();
  });

  it("DB の検索に失敗したら null（bigram だけで続ける）", async () => {
    state.rpc = vi.fn(async () => ({ data: null, error: { message: "boom" } }));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await rankChunksByVector("w", "検定", chunks)).toBeNull();
    spy.mockRestore();
  });
});
