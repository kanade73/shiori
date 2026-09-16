import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Type } from "@google/genai";
import { AllKeysRestingError } from "./key-pool";
import { groqEnabled, groqGenerateContent, groqModel, isGeminiUnusable, retryAfterMs, toGroqRequest, toJsonSchema, toMessages } from "./groq";

// Gemini の枠切れ・キー無し・混雑のときに逃げる先。OpenAI 互換なので、Gemini の形を訳せているかを見る。

const schema = {
  type: Type.OBJECT,
  properties: {
    shouldComment: { type: Type.BOOLEAN },
    message: { type: Type.STRING },
    tags: { type: Type.ARRAY, items: { type: Type.STRING, enum: ["a", "b"] } },
  },
  required: ["shouldComment", "message"],
};

describe("toJsonSchema: Gemini の responseSchema を JSON Schema に訳す", () => {
  it("型名を小文字にし、strict に要る required と additionalProperties を補う", () => {
    expect(toJsonSchema(schema)).toEqual({
      type: "object",
      properties: {
        shouldComment: { type: "boolean" },
        message: { type: "string" },
        tags: { type: "array", items: { type: "string", enum: ["a", "b"] } },
      },
      required: ["shouldComment", "message", "tags"],
      additionalProperties: false,
    });
  });

  it("入れ子の object も同じように訳す", () => {
    const nested = { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { id: { type: Type.STRING } } } };
    expect(toJsonSchema(nested)).toEqual({
      type: "array",
      items: { type: "object", properties: { id: { type: "string" } }, required: ["id"], additionalProperties: false },
    });
  });
});

describe("toMessages: contents を OpenAI 互換の messages にする", () => {
  it("systemInstruction は system、Gemini の model は assistant にする", () => {
    const messages = toMessages({
      model: "gemini-3.5-flash-lite",
      contents: [
        { role: "user", parts: [{ text: "古本屋！" }] },
        { role: "model", parts: [{ text: "あの子の話ね。" }] },
        { role: "user", parts: [{ text: "どんなカチューシャ？" }] },
      ],
      config: { systemInstruction: "あなたはシオリ" },
    });
    expect(messages).toEqual([
      { role: "system", content: "あなたはシオリ" },
      { role: "user", content: "古本屋！" },
      { role: "assistant", content: "あの子の話ね。" },
      { role: "user", content: "どんなカチューシャ？" },
    ]);
  });

  it("中身の無いターンは落とす", () => {
    const messages = toMessages({ model: "m", contents: [{ role: "user", parts: [{ text: "  " }] }] });
    expect(messages).toEqual([]);
  });
});

describe("toGroqRequest", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("responseSchema があれば json_schema の strict で投げ、モデルは GROQ_MODEL", () => {
    vi.stubEnv("GROQ_MODEL", "openai/gpt-oss-20b");
    const body = toGroqRequest({
      model: "gemini-3.1-flash-lite",
      contents: [{ role: "user", parts: [{ text: "本文" }] }],
      config: { responseMimeType: "application/json", responseSchema: schema, maxOutputTokens: 1024 },
    });
    expect(body.model).toBe("openai/gpt-oss-20b");
    expect(body.max_completion_tokens).toBe(400);
    expect(body.response_format).toMatchObject({ type: "json_schema", json_schema: { strict: true } });
  });

  it("スキーマ無しで JSON を求めるだけなら json_object", () => {
    const body = toGroqRequest({ model: "m", contents: "本文", config: { responseMimeType: "application/json" } });
    expect(body.response_format).toEqual({ type: "json_object" });
  });

  it("素のテキスト（シオリの返答）なら response_format を付けない", () => {
    const body = toGroqRequest({ model: "m", contents: "本文", config: { maxOutputTokens: 1024 } });
    expect(body.response_format).toBeUndefined();
  });

  it("既定のモデルは呼び出し口ごとに分ける（1分あたりのトークンの枠がモデルごとに別のため）", () => {
    for (const env of ["GROQ_MODEL", "GROQ_TOSHIO_MODEL", "GROQ_TOPIC_MODEL", "GROQ_EXTRACT_MODEL", "GROQ_ROUTER_MODEL"]) {
      vi.stubEnv(env, "");
    }
    // 会話は大きいモデル、資料係と取り出しは大きいスキーマに応えられるモデル、判定役は小さいモデル
    expect(groqModel("chat")).toBe("openai/gpt-oss-120b");
    expect(groqModel("topic")).toBe("openai/gpt-oss-120b");
    expect(groqModel("router")).toBe("openai/gpt-oss-20b");
    expect(groqModel("extract")).toBe("qwen/qwen3.8-27b");
    expect(groqModel("toshio")).toBe("openai/gpt-oss-20b");
  });

  it("呼び出し口ごとに環境変数で差し替えられる", () => {
    vi.stubEnv("GROQ_EXTRACT_MODEL", "openai/gpt-oss-safeguard-20b");
    expect(toGroqRequest({ model: "m", contents: "本文" }, "extract").model).toBe("openai/gpt-oss-safeguard-20b");
  });
});

describe("isGeminiUnusable: 逃げてよい失敗かを見分ける", () => {
  it("2本とも休み中なら逃げる", () => {
    expect(isGeminiUnusable(new AllKeysRestingError("gemini-3.5-flash-lite"))).toBe(true);
  });

  it("枠切れ（429）・無効なキー（403）なら逃げる", () => {
    const quota = Object.assign(new Error('{"error":{"code":429,"details":[{"quotaId":"GenerateRequestsPerDay"}]}}'), { status: 429 });
    expect(isGeminiUnusable(quota)).toBe(true);
    expect(isGeminiUnusable(Object.assign(new Error("API key not valid"), { status: 403 }))).toBe(true);
  });

  it("混雑（503）なら逃げる（キーを変えても直らない）", () => {
    expect(isGeminiUnusable(new Error('{"error":{"code":503,"status":"UNAVAILABLE"}}'))).toBe(true);
  });

  it("それ以外（スキーマ違反など）は逃げない", () => {
    expect(isGeminiUnusable(new Error('{"error":{"code":400,"message":"Invalid JSON payload"}}'))).toBe(false);
    expect(isGeminiUnusable(new Error("Failed to parse claims output"))).toBe(false);
  });
});

describe("groqGenerateContent", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubEnv("GROQ_API_KEY", "gsk_test");
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("chat completions に投げ、返答を Gemini と同じ { text } で返す", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: "そうだね。" } }] }),
    });
    const result = await groqGenerateContent({ model: "gemini-3.5-flash-lite", contents: "本文" });
    expect(result.text).toBe("そうだね。");

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit & { headers: Record<string, string> }];
    expect(url).toBe("https://api.groq.com/openai/v1/chat/completions");
    expect(init.headers.authorization).toBe("Bearer gsk_test");
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("非 2xx は投げる（呼び出し側の fallback に任せる）", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 429, headers: new Headers(), text: async () => "rate limit" });
    await expect(groqGenerateContent({ model: "m", contents: "本文" })).rejects.toThrow("[groq] HTTP 429");
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("1分の枠に当たっても、待ちが短ければ1回だけ送り直す", async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: false, status: 429, headers: new Headers({ "retry-after": "0" }), text: async () => "rate limit" })
      .mockResolvedValueOnce({ ok: true, status: 200, headers: new Headers(), json: async () => ({ choices: [{ message: { content: "うん。" } }] }) });
    expect((await groqGenerateContent({ model: "m", contents: "本文" })).text).toBe("うん。");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("待ちが長ければ送り直さない（会話が止まるため）", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 429, headers: new Headers({ "retry-after": "42" }), text: async () => "rate limit" });
    await expect(groqGenerateContent({ model: "m", contents: "本文" })).rejects.toThrow("[groq] HTTP 429");
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("キーが無ければ投げる", async () => {
    vi.stubEnv("GROQ_API_KEY", "");
    expect(groqEnabled()).toBe(false);
    await expect(groqGenerateContent({ model: "m", contents: "本文" })).rejects.toThrow("GROQ_API_KEY");
  });
});

describe("出力トークンの上限（Groq の OTPM は1分1,000）", () => {
  it("呼び出し口ごとの上限に丸める（要求した分だけ枠を予約されるため、大きく書くと1分に1回しか通らない）", () => {
    const ask = { model: "m", contents: "本文", config: { maxOutputTokens: 2048 } };
    expect(toGroqRequest(ask, "chat").max_completion_tokens).toBe(400);
    expect(toGroqRequest(ask, "toshio").max_completion_tokens).toBe(350);
    expect(toGroqRequest(ask, "topic").max_completion_tokens).toBe(550);
    expect(toGroqRequest(ask, "extract").max_completion_tokens).toBe(400);
    expect(toGroqRequest(ask, "router").max_completion_tokens).toBe(80);
  });

  it("同じモデルに乗る口の出力の合計が、1分の枠（1,000）に収まっている", () => {
    const cap = (kind: "chat" | "toshio" | "topic" | "extract" | "router") =>
      Number(toGroqRequest({ model: "m", contents: "本文" }, kind).max_completion_tokens);
    const perModel = new Map<string, number>();
    for (const kind of ["chat", "toshio", "topic", "extract", "router"] as const) {
      const model = groqModel(kind);
      perModel.set(model, (perModel.get(model) ?? 0) + cap(kind));
    }
    for (const [, total] of perModel) expect(total).toBeLessThanOrEqual(1000);
  });

  it("retry-after は秒。読めれば ms にする", () => {
    expect(retryAfterMs("2.5")).toBe(2500);
    expect(retryAfterMs(null)).toBeNull();
    expect(retryAfterMs("しばらく")).toBeNull();
  });
});
