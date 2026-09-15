import { beforeEach, describe, expect, it, vi } from "vitest";

// issue #14: セッションの作成では話数を聞かず、シオリの「今日は何について話したい?」から始める
const mocks = vi.hoisted(() => ({
  appendMessage: vi.fn(),
  createSession: vi.fn(),
  getFabricatedFacts: vi.fn(),
  listSessions: vi.fn(),
  saveMessageClaims: vi.fn(),
  getWork: vi.fn(),
}));
vi.mock("@/lib/server/store", () => ({
  appendMessage: mocks.appendMessage,
  createSession: mocks.createSession,
  getFabricatedFacts: mocks.getFabricatedFacts,
  listSessions: mocks.listSessions,
  saveMessageClaims: mocks.saveMessageClaims,
}));
vi.mock("@/lib/server/works", () => ({ getWork: mocks.getWork }));

import { POST } from "./route";

function post(body: unknown) {
  return POST(
    new Request("http://localhost/api/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getWork.mockReturnValue({ id: "w", title: "テスト作品", createdAt: "" });
  mocks.createSession.mockReturnValue({ id: "s1", workId: "w", currentEpisode: 0, createdAt: "", updatedAt: "" });
  mocks.appendMessage.mockReturnValue({ id: "msg-1" });
});

describe("POST /api/sessions", () => {
  it("作品だけでセッションを作り、シオリの問いかけを最初の発話として保存する", async () => {
    const res = await post({ workId: "w" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ sessionId: "s1", openingMessage: "……今日は何について話したい?" });
    expect(mocks.createSession).toHaveBeenCalledWith("w");
    expect(mocks.appendMessage).toHaveBeenCalledWith("s1", "assistant", "……今日は何について話したい?", "shiori");
  });

  it("問いかけには「主張なし」を記録する（答え合わせで記録前の旧データ扱いにしない）", async () => {
    await post({ workId: "w" });
    expect(mocks.saveMessageClaims).toHaveBeenCalledWith("s1", "msg-1", []);
  });

  it("workId が無ければ 400、作品が無ければ 404", async () => {
    expect((await post({})).status).toBe(400);
    mocks.getWork.mockReturnValue(null);
    expect((await post({ workId: "missing" })).status).toBe(404);
    expect(mocks.createSession).not.toHaveBeenCalled();
  });
});
