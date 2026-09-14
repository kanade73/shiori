import { beforeEach, describe, expect, it, vi } from "vitest";

// 答え合わせの API: 答え合わせ前は真偽を返さないこと、予想は実在する主張の分だけ
// 受け付けること、答え合わせ済みなら最初の予想を上書きしないことを固定する。
const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  getMessages: vi.fn(),
  getMessageClaims: vi.fn(),
  getFabricatedFacts: vi.fn(),
  revealSession: vi.fn(),
  getCanonFactsUpTo: vi.fn(),
}));
vi.mock("@/lib/server/store", () => ({
  getSession: mocks.getSession,
  getMessages: mocks.getMessages,
  getMessageClaims: mocks.getMessageClaims,
  getFabricatedFacts: mocks.getFabricatedFacts,
  revealSession: mocks.revealSession,
}));
vi.mock("@/lib/server/works", () => ({ getCanonFactsUpTo: mocks.getCanonFactsUpTo }));

import { GET, POST } from "./route";

const params = { params: Promise.resolve({ sessionId: "s1" }) };
const session = { id: "s1", workId: "w", currentEpisode: 3, createdAt: "", updatedAt: "" };

function post(body: unknown) {
  return POST(
    new Request("http://localhost/api/sessions/s1/reveal", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    params,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getSession.mockReturnValue(session);
  mocks.getMessages.mockReturnValue([
    { id: "m1", sessionId: "s1", role: "assistant", content: "裏にレシピがある。", createdAt: "", speaker: "shiori" },
  ]);
  mocks.getMessageClaims.mockReturnValue({
    m1: [
      {
        id: "claim1",
        subject: "A",
        relation: "has",
        object: "レシピ",
        negated: false,
        claim: "A の裏にレシピがある",
        grounding: "fabricated",
        sourceCanonFactIds: [],
        quote: "裏にレシピがある",
      },
    ],
  });
  mocks.getFabricatedFacts.mockReturnValue([]);
  mocks.getCanonFactsUpTo.mockReturnValue([]);
  mocks.revealSession.mockImplementation((_id: string, guesses: Record<string, string>) => ({
    ...session,
    reveal: { revealedAt: "2026-09-14T13:00:00.000Z", guesses },
  }));
});

describe("GET /api/sessions/[id]/reveal", () => {
  it("答え合わせ前は問題だけ（真偽なし）", async () => {
    const res = await GET(new Request("http://localhost"), params);
    const data = await res.json();
    expect(data).toEqual({ status: "pending", questions: [{ id: "claim1", speaker: "shiori", text: "裏にレシピがある", createdAt: "" }] });
  });

  it("視聴済み範囲の canonFact だけを根拠の候補にする", async () => {
    await GET(new Request("http://localhost"), params);
    expect(mocks.getCanonFactsUpTo).toHaveBeenCalledWith("w", 3);
  });

  it("セッションが無ければ 404", async () => {
    mocks.getSession.mockReturnValue(null);
    const res = await GET(new Request("http://localhost"), params);
    expect(res.status).toBe(404);
  });
});

describe("POST /api/sessions/[id]/reveal", () => {
  it("実在する主張への true/lie の予想だけを保存し、真偽つきの結果を返す", async () => {
    const res = await post({ guesses: { claim1: "lie", unknown: "lie", claim2: "maybe" } });
    expect(mocks.revealSession).toHaveBeenCalledWith("s1", { claim1: "lie" });
    const data = await res.json();
    expect(data.status).toBe("revealed");
    expect(data.statements).toEqual([
      { id: "claim1", messageId: "m1", verdict: "lie", claim: "A の裏にレシピがある", quote: "裏にレシピがある", sources: [] },
    ]);
    expect(data.reveal.guesses).toEqual({ claim1: "lie" });
  });

  it("予想なしでも答え合わせできる", async () => {
    const res = await post({});
    expect(res.status).toBe(200);
    expect(mocks.revealSession).toHaveBeenCalledWith("s1", {});
  });

  it("guesses がオブジェクトでなければ 400", async () => {
    const res = await post({ guesses: ["lie"] });
    expect(res.status).toBe(400);
    expect(mocks.revealSession).not.toHaveBeenCalled();
  });
});
