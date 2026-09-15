import { describe, expect, it, vi } from "vitest";
import {
  AllKeysRestingError,
  classifyKeyFailure,
  createKeyRotation,
  msUntilPacificMidnight,
  type ApiKeyEntry,
} from "./key-pool";

// 2026-09-15 12:00 PDT（= 19:00 UTC）。太平洋時間の0時まで12時間
const NOON_PT = Date.UTC(2026, 8, 15, 19, 0, 0);
const MODEL = "gemini-3.5-flash-lite";

function apiError(status: number, body: unknown) {
  return Object.assign(new Error(JSON.stringify(body)), { status });
}

const perMinute = (retryDelay = "30s") =>
  apiError(429, {
    error: {
      code: 429,
      status: "RESOURCE_EXHAUSTED",
      details: [
        {
          "@type": "type.googleapis.com/google.rpc.QuotaFailure",
          violations: [{ quotaId: "GenerateRequestsPerMinutePerProjectPerModel-FreeTier" }],
        },
        { "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay },
      ],
    },
  });

const perDay = () =>
  apiError(429, {
    error: {
      code: 429,
      status: "RESOURCE_EXHAUSTED",
      details: [
        {
          "@type": "type.googleapis.com/google.rpc.QuotaFailure",
          violations: [{ quotaId: "GenerateRequestsPerDayPerProjectPerModel-FreeTier" }],
        },
        { "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: "40s" },
      ],
    },
  });

/** 自分（mine）と先輩（senpai）の2本。`fail` に積んだ失敗を順に返し、無ければそのキーの名前を返す */
function setup() {
  let clock = NOON_PT;
  const failures: Record<string, Error[]> = { mine: [], senpai: [] };
  const calls: string[] = [];
  const keys: ApiKeyEntry<string>[] = [
    { label: "GEMINI_API_KEY", id: "mine", client: "mine" },
    { label: "GEMINI_API_KEY_2", id: "senpai", client: "senpai" },
  ];
  const log = vi.fn();
  const withApiKey = createKeyRotation(keys, { now: () => clock, log });
  const send = (model = MODEL) =>
    withApiKey(model, async (client) => {
      calls.push(client);
      const failure = failures[client].shift();
      if (failure) throw failure;
      return client;
    });
  return {
    send,
    calls,
    log,
    fail: (client: "mine" | "senpai", ...errors: Error[]) => failures[client].push(...errors),
    advance: (ms: number) => (clock += ms),
  };
}

describe("createKeyRotation: 自分のキーが切れたら先輩の、先輩のが切れたら自分のに切り替える", () => {
  it("普段は1本目（自分）を使い続ける", async () => {
    const t = setup();
    expect(await t.send()).toBe("mine");
    expect(await t.send()).toBe("mine");
    expect(t.calls).toEqual(["mine", "mine"]);
  });

  it("自分のが上限に達したら、同じリクエストを先輩ので送り直し、以後は先輩のを使う", async () => {
    const t = setup();
    t.fail("mine", perMinute("30s"));
    expect(await t.send()).toBe("senpai");
    // 自分のが1分の休みを終えても、先輩のが切れるまでは先輩のまま
    t.advance(60_000);
    expect(await t.send()).toBe("senpai");
    expect(t.calls).toEqual(["mine", "senpai", "senpai"]);
    expect(t.log).toHaveBeenCalledWith(expect.stringContaining("GEMINI_API_KEY_2 に切り替えた"));
  });

  it("先輩のも上限に達したら、自分のに戻る", async () => {
    const t = setup();
    t.fail("mine", perMinute("30s"));
    await t.send();
    t.advance(31_000);
    t.fail("senpai", perMinute("30s"));
    expect(await t.send()).toBe("mine");
    expect(t.calls).toEqual(["mine", "senpai", "senpai", "mine"]);
  });

  it("両方とも上限なら 429 を投げ、休み中は送らずに投げる", async () => {
    const t = setup();
    const last = perMinute("30s");
    t.fail("mine", perMinute("30s"));
    t.fail("senpai", last);
    await expect(t.send()).rejects.toBe(last);
    await expect(t.send()).rejects.toBeInstanceOf(AllKeysRestingError);
    expect(t.calls).toEqual(["mine", "senpai"]);
    // 休みが明ければまた送る
    t.advance(30_000);
    expect(await t.send()).toBe("mine");
  });

  it("1日の上限なら太平洋時間の0時まで戻らない", async () => {
    const t = setup();
    t.fail("mine", perDay());
    await t.send();
    t.advance(60 * 60_000);
    t.fail("senpai", perMinute("30s"));
    await expect(t.send()).rejects.toThrow();
    // 12時間後（0時 PT）に1日の枠が戻る。先輩のが切れたら自分のに戻れる
    t.advance(11 * 60 * 60_000);
    t.fail("senpai", perMinute("30s"));
    expect(await t.send()).toBe("mine");
  });

  it("休ませるのはモデルごと（別のモデルは自分のをそのまま使う）", async () => {
    const t = setup();
    t.fail("mine", perDay());
    expect(await t.send(MODEL)).toBe("senpai");
    expect(await t.send("gemini-3.1-flash-lite")).toBe("mine");
  });

  it("混雑（503）などキーと関係ない失敗では切り替えずに投げる", async () => {
    const t = setup();
    const busy = apiError(503, { error: { code: 503, status: "UNAVAILABLE" } });
    t.fail("mine", busy);
    await expect(t.send()).rejects.toBe(busy);
    expect(await t.send()).toBe("mine");
    expect(t.calls).toEqual(["mine", "mine"]);
  });

  it("無効なキーは以後使わない", async () => {
    const t = setup();
    t.fail("mine", perMinute("30s"));
    t.fail("senpai", apiError(400, { error: { code: 400, message: "API key not valid.", status: "INVALID_ARGUMENT" } }));
    await expect(t.send()).rejects.toThrow();
    t.advance(30_000);
    expect(await t.send()).toBe("mine");
    t.fail("mine", perMinute("30s"));
    await expect(t.send()).rejects.toBeInstanceOf(Error);
    expect(t.calls.filter((c) => c === "senpai")).toHaveLength(1);
  });

  it("キーが1本だけなら今までどおり（429 もそのまま投げ、次もそのキーで送る）", async () => {
    const calls: number[] = [];
    const withApiKey = createKeyRotation([{ label: "GEMINI_API_KEY", id: "only", client: 1 }], { log: vi.fn() });
    const limit = perDay();
    await expect(
      withApiKey(MODEL, async (c) => {
        calls.push(c);
        throw limit;
      }),
    ).rejects.toBe(limit);
    expect(await withApiKey(MODEL, async (c) => (calls.push(c), "ok"))).toBe("ok");
    expect(calls).toEqual([1, 1]);
  });
});

describe("classifyKeyFailure", () => {
  it("1分の上限は RetryInfo の待ち時間だけ休ませる", () => {
    expect(classifyKeyFailure(perMinute("12.5s"), NOON_PT)).toEqual({ kind: "minute", until: NOON_PT + 12_500 });
  });

  it("1日の上限は RetryInfo があっても太平洋時間の0時まで休ませる", () => {
    expect(classifyKeyFailure(perDay(), NOON_PT)).toEqual({ kind: "day", until: NOON_PT + 12 * 60 * 60_000 });
  });

  it("本文が読めない 429 は60秒休ませる", () => {
    const error = Object.assign(new Error("Too Many Requests"), { status: 429 });
    expect(classifyKeyFailure(error, NOON_PT)).toEqual({ kind: "minute", until: NOON_PT + 60_000 });
  });

  it("キーの問題（401・403・API_KEY_INVALID）は invalid、それ以外は切り替えない", () => {
    expect(classifyKeyFailure(apiError(403, { error: { code: 403 } }), NOON_PT)).toEqual({ kind: "invalid" });
    expect(
      classifyKeyFailure(apiError(400, { error: { details: [{ reason: "API_KEY_INVALID" }] } }), NOON_PT),
    ).toEqual({ kind: "invalid" });
    expect(classifyKeyFailure(apiError(400, { error: { message: "bad schema" } }), NOON_PT)).toBeNull();
    expect(classifyKeyFailure(apiError(500, { error: { code: 500 } }), NOON_PT)).toBeNull();
    expect(classifyKeyFailure(new Error("network"), NOON_PT)).toBeNull();
  });
});

describe("msUntilPacificMidnight", () => {
  it("夏時間（PDT, UTC-7）と冬時間（PST, UTC-8）で0時までを数える", () => {
    expect(msUntilPacificMidnight(Date.UTC(2026, 8, 15, 6, 0, 0))).toBe(60 * 60_000); // 23:00 PDT
    expect(msUntilPacificMidnight(Date.UTC(2026, 0, 15, 7, 30, 0))).toBe(30 * 60_000); // 23:30 PST
    expect(msUntilPacificMidnight(Date.UTC(2026, 0, 15, 8, 0, 0))).toBe(24 * 60 * 60_000); // 0:00 PST
  });
});
