import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Claim } from "./types";

// store は import 時に DATA_DIR を読むので、一時ディレクトリを指してから読み込む
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "store-reveal-"));
let store: typeof import("./store");

beforeAll(async () => {
  process.env.DATA_DIR = dir;
  store = await import("./store");
});

afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

const lie: Claim = {
  subject: "A",
  relation: "has",
  object: "レシピ",
  negated: false,
  claim: "A はレシピを持っている",
  grounding: "fabricated",
  sourceCanonFactIds: [],
  quote: "レシピ",
};

describe("store: 答え合わせ", () => {
  it("発話の claims を ID 付きで保存し、セッション単位で取り出せる", () => {
    const session = store.createSession("w");
    const [saved] = store.saveMessageClaims(session.id, "m1", [lie]);
    expect(saved.id).toMatch(/^claim_/);
    expect(store.getMessageClaims(session.id)).toEqual({ m1: [saved] });
    expect(store.getMessageClaims("other")).toEqual({});
  });

  it("答え合わせは1回きり。2回目は最初の予想と時刻を残す", () => {
    const session = store.createSession("w");
    const first = store.revealSession(session.id, { c1: "lie" });
    const second = store.revealSession(session.id, { c1: "true" });
    expect(first?.reveal?.guesses).toEqual({ c1: "lie" });
    expect(second?.reveal).toEqual(first?.reveal);
    expect(store.getSession(session.id)?.reveal?.guesses).toEqual({ c1: "lie" });
  });

  it("無いセッションは null", () => {
    expect(store.revealSession("missing", {})).toBeNull();
  });
});
