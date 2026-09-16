import { beforeEach, describe, expect, it } from "vitest";
import * as store from "./store";
import { memoryBackend } from "./store-memory";
import type { Claim } from "./types";

// 本番の置き場所は Supabase だが、ここで確かめたいのは store.ts の意味論なので
// インメモリの backend を差し込んで回す（store-memory.ts はテスト専用）
beforeEach(() => {
  store.setStoreBackend(memoryBackend());
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
  it("発話の claims を ID 付きで保存し、セッション単位で取り出せる", async () => {
    const session = await store.createSession("w");
    const [saved] = await store.saveMessageClaims(session.id, "m1", [lie]);
    expect(saved.id).toMatch(/^claim_/);
    expect(await store.getMessageClaims(session.id)).toEqual({ m1: [saved] });
    expect(await store.getMessageClaims("other")).toEqual({});
  });

  it("答え合わせは1回きり。2回目は最初の予想と時刻を残す", async () => {
    const session = await store.createSession("w");
    const first = await store.revealSession(session.id, { c1: "lie" });
    const second = await store.revealSession(session.id, { c1: "true" });
    expect(first?.reveal?.guesses).toEqual({ c1: "lie" });
    expect(second?.reveal).toEqual(first?.reveal);
    expect((await store.getSession(session.id))?.reveal?.guesses).toEqual({ c1: "lie" });
  });

  it("無いセッションは null", async () => {
    expect(await store.revealSession("missing", {})).toBeNull();
  });
});

describe("store: セッションの削除", () => {
  it("セッションと、そのメッセージ・嘘・主張の記録を消す。他のセッションは残す", async () => {
    const target = await store.createSession("w");
    const other = await store.createSession("w");
    for (const s of [target, other]) {
      const msg = await store.appendMessage(s.id, "assistant", "裏にレシピがある", "shiori");
      await store.saveMessageClaims(s.id, msg.id, [lie]);
      await store.addFabricatedFact({
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

    expect(await store.deleteSession(target.id)).toBe(true);
    expect(await store.getSession(target.id)).toBeNull();
    expect(await store.getMessages(target.id)).toEqual([]);
    expect(await store.getFabricatedFacts(target.id)).toEqual([]);
    expect(await store.getMessageClaims(target.id)).toEqual({});
    expect((await store.listSessions("w")).map((s) => s.id)).not.toContain(target.id);

    expect(await store.getSession(other.id)).not.toBeNull();
    expect(await store.getMessages(other.id)).toHaveLength(1);
    expect(await store.getFabricatedFacts(other.id)).toHaveLength(1);
  });

  it("無いセッションは false", async () => {
    expect(await store.deleteSession("missing")).toBe(false);
  });
});
