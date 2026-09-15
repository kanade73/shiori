import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

// ベクトルDB（sqlite-vec）そのもの。DB は一時ディレクトリに作る
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vector-db-"));
let mod: typeof import("./vector-db");

beforeAll(async () => {
  process.env.DATA_DIR = dir;
  mod = await import("./vector-db");
});

afterAll(() => {
  mod.closeVectorDb();
  fs.rmSync(dir, { recursive: true, force: true });
});

beforeEach(() => {
  mod.closeVectorDb();
  fs.rmSync(path.join(dir, "vectors"), { recursive: true, force: true });
});

const row = (key: string, embedding: number[]) => ({ key, label: key, text: `${key}の本文`, embedding });

describe("vectorDb", () => {
  it("近い順に返し、類似度は 1 - コサイン距離", () => {
    const db = mod.vectorDb("m", 3);
    db.add("w", [row("x", [1, 0, 0]), row("y", [0, 1, 0])]);
    const got = db.nearest("w", [1, 0.1, 0], 2);
    expect(got.map((n) => n.key)).toEqual(["x", "y"]);
    expect(got[0].similarity).toBeGreaterThan(0.99);
  });

  it("同じ段落を二度入れても落ちない（別々に動いた埋め込みが重なったとき）", () => {
    const db = mod.vectorDb("m", 3);
    db.add("w", [row("x", [1, 0, 0])]);
    expect(() => db.add("w", [row("x", [1, 0, 0]), row("y", [0, 1, 0])])).not.toThrow();
    expect([...db.keys("w")].sort()).toEqual(["x", "y"]);
  });

  it("モデル・次元ごとにファイルを分ける", () => {
    mod.vectorDb("m", 3).add("w", [row("x", [1, 0, 0])]);
    expect(fs.existsSync(path.join(dir, "vectors", "m-3.sqlite"))).toBe(true);
    expect(mod.vectorDb("other", 3).keys("w").size).toBe(0);
    expect(mod.vectorDb("m", 3).keys("w").size).toBe(1);
  });
});
