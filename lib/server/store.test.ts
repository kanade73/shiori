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

describe("store: セッションの削除", () => {
  it("セッションと、そのメッセージ・嘘・主張の記録を消す。他のセッションは残す", () => {
    const target = store.createSession("w");
    const other = store.createSession("w");
    for (const s of [target, other]) {
      const msg = store.appendMessage(s.id, "assistant", "裏にレシピがある", "shiori");
      store.saveMessageClaims(s.id, msg.id, [lie]);
      store.addFabricatedFact({
        sessionId: s.id,
        claim: lie.claim,
        subject: lie.subject,
        relation: lie.relation,
        object: lie.object,
        negated: false,
        sourceCanonFactIds: [],
        introducedMessageId: msg.id,
        confidence: 1,
      });
    }

    expect(store.deleteSession(target.id)).toBe(true);
    expect(store.getSession(target.id)).toBeNull();
    expect(store.getMessages(target.id)).toEqual([]);
    expect(store.getFabricatedFacts(target.id)).toEqual([]);
    expect(store.getMessageClaims(target.id)).toEqual({});
    expect(store.listSessions("w").map((s) => s.id)).not.toContain(target.id);

    expect(store.getSession(other.id)).not.toBeNull();
    expect(store.getMessages(other.id)).toHaveLength(1);
    expect(store.getFabricatedFacts(other.id)).toHaveLength(1);
  });

  it("無いセッションは false", () => {
    expect(store.deleteSession("missing")).toBe(false);
  });
});
