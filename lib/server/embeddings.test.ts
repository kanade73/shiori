import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { SourceChunk } from "./types";

// 段落のベクトル検索（issue #22: ベクトルDB = sqlite-vec）。埋め込み API は差し替え、DB は一時ディレクトリに作る
const { embedContent } = vi.hoisted(() => ({ embedContent: vi.fn() }));
vi.mock("./llm/client", () => ({ ai: { models: { embedContent } }, EMBEDDING_MODEL: "test-embedding" }));

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "embeddings-"));
let mod: typeof import("./embeddings");

beforeAll(async () => {
  process.env.DATA_DIR = dir;
  mod = await import("./embeddings");
  vi.spyOn(console, "info").mockImplementation(() => {});
});

afterAll(() => {
  mod.clearEmbeddingCache();
  fs.rmSync(dir, { recursive: true, force: true });
});

function chunk(id: string, text: string): SourceChunk {
  return { id, sourceTitle: "記事", url: "u", heading: "", label: "", text };
}

// 768次元のうち先頭の2次元だけ使う: 「ラーメン」を含めば x 軸、「検定」なら y 軸、ほかは斜め
function vectorOf(text: string): number[] {
  const v = new Array(768).fill(0);
  if (text.includes("ラーメン")) v[0] = 1;
  else if (text.includes("検定")) v[1] = 1;
  else [v[0], v[1]] = [0.5, 0.5];
  return v;
}

beforeEach(() => {
  mod.clearEmbeddingCache();
  fs.rmSync(path.join(dir, "vectors"), { recursive: true, force: true });
  embedContent.mockReset();
  embedContent.mockImplementation(async ({ contents }: { contents: string[] }) => ({
    embeddings: contents.map((text) => ({ values: vectorOf(text) })),
  }));
});

const chunks = [chunk("a", "ラーメン店に入れない"), chunk("b", "草むしり検定を受ける"), chunk("c", "リボン")];

describe("rankChunksByVector", () => {
  it("段落がまだ1件も埋め込まれていなければ、裏で作り始めて null（会話は待たせず bigram だけで続ける）", async () => {
    expect(await mod.rankChunksByVector("w", "ラーメン屋", chunks)).toBeNull();
    // 裏の埋め込みは段落のために1回（検索語の分はまだ呼んでいない）
    expect(embedContent).toHaveBeenCalledTimes(1);
    expect(embedContent.mock.calls[0][0].config.taskType).toBe("RETRIEVAL_DOCUMENT");
  });

  it("揃ったら検索語を埋め込み、DB の中で近い順（コサイン類似度の高い順）に並べる", async () => {
    await mod.ensureChunkEmbeddings("w", chunks);
    const ranked = await mod.rankChunksByVector("w", "ラーメン屋さん", chunks);
    expect(ranked?.map((r) => r.chunk.id)).toEqual(["a", "c", "b"]);
    expect(ranked?.[0].score).toBeCloseTo(1);
    expect(ranked?.[2].score).toBeCloseTo(0);
    expect(embedContent.mock.lastCall![0].config.taskType).toBe("RETRIEVAL_QUERY");
  });

  it("limit で上位だけ返す", async () => {
    await mod.ensureChunkEmbeddings("w", chunks);
    expect((await mod.rankChunksByVector("w", "検定", chunks, 1))?.map((r) => r.chunk.id)).toEqual(["b"]);
  });

  it("埋め込みは DATA_DIR のベクトルDBに残り、再起動後も埋め込み直さない", async () => {
    await mod.ensureChunkEmbeddings("w", chunks);
    expect(fs.existsSync(path.join(dir, "vectors", "test-embedding-768.sqlite"))).toBe(true);
    mod.clearEmbeddingCache();
    embedContent.mockClear();
    await mod.rankChunksByVector("w", "検定", chunks);
    // 検索語の1回だけ
    expect(embedContent).toHaveBeenCalledTimes(1);
  });

  it("一部しか埋め込まれていなくても、埋め込み済みの段落の中で探し、残りは裏で作る", async () => {
    await mod.ensureChunkEmbeddings("w", chunks.slice(0, 2));
    embedContent.mockClear();
    // 裏の埋め込みは検索が終わるまで返らないことにする
    let finishBackground = () => {};
    const background = new Promise<void>((resolve) => (finishBackground = resolve));
    const respond = embedContent.getMockImplementation()!;
    embedContent.mockImplementation(async (args: { config: { taskType: string } }) => {
      if (args.config.taskType === "RETRIEVAL_DOCUMENT") await background;
      return respond(args);
    });

    const ranked = await mod.rankChunksByVector("w", "ラーメン", chunks);
    expect(ranked?.map((r) => r.chunk.id)).toEqual(["a", "b"]);
    finishBackground();
    await mod.ensureChunkEmbeddings("w", chunks); // 動いている裏の仕事を待つ
    // 残りの段落の埋め込み（1件）と検索語
    const tasks = embedContent.mock.calls.map((c) => [c[0].config.taskType, c[0].contents.length]);
    expect(tasks).toContainEqual(["RETRIEVAL_DOCUMENT", 1]);
    expect(tasks).toContainEqual(["RETRIEVAL_QUERY", 1]);
  });

  it("記事が書き換わってもう無い段落は DB から消し、検索結果にも出さない", async () => {
    await mod.ensureChunkEmbeddings("w", chunks);
    const rewritten = [chunk("a", "ラーメン店に入れない"), chunk("d", "ラーメンの鎧さん")];
    await mod.ensureChunkEmbeddings("w", rewritten);
    const ranked = await mod.rankChunksByVector("w", "リボン", rewritten);
    expect(ranked?.map((r) => r.chunk.id).sort()).toEqual(["a", "d"]);
  });

  it("作品ごとに区画を分ける（別の作品の段落は出さない）", async () => {
    await mod.ensureChunkEmbeddings("w", chunks);
    const other = [chunk("x", "検定の話")];
    await mod.ensureChunkEmbeddings("other", other);
    expect((await mod.rankChunksByVector("other", "検定", other))?.map((r) => r.chunk.id)).toEqual(["x"]);
    // 別の作品の段落を入れても、この作品の段落は消えない
    expect((await mod.rankChunksByVector("w", "検定", chunks))?.map((r) => r.chunk.id)).toEqual(["b", "c", "a"]);
  });

  it("無料枠（1分100件）を超えないよう、段落は80件ずつ1分おきに埋め込む", async () => {
    vi.useFakeTimers();
    try {
      const many = Array.from({ length: 170 }, (_, i) => chunk(`m${i}`, `段落${i}`));
      const job = mod.ensureChunkEmbeddings("w", many);
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
    await mod.ensureChunkEmbeddings("w", chunks);
    embedContent.mockRejectedValue(new Error("429"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await mod.rankChunksByVector("w", "検定", chunks)).toBeNull();
    spy.mockRestore();
  });
});
