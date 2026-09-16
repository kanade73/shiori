import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Type } from "@google/genai";
import { AllKeysRestingError } from "./key-pool";
import { groqEnabled, groqGenerateContent, groqModel, isGeminiUnusable, toGroqRequest, toJsonSchema, toMessages } from "./groq";

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
    expect(body.max_completion_tokens).toBe(1024);
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

  it("既定のモデルは production 扱いで JSON schema の strict に対応しているもの", () => {
    vi.stubEnv("GROQ_MODEL", "");
    expect(groqModel()).toBe("openai/gpt-oss-120b");
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
    fetchMock.mockResolvedValue({ ok: false, status: 429, text: async () => "rate limit" });
    await expect(groqGenerateContent({ model: "m", contents: "本文" })).rejects.toThrow("[groq] HTTP 429");
  });

  it("キーが無ければ投げる", async () => {
    vi.stubEnv("GROQ_API_KEY", "");
    expect(groqEnabled()).toBe(false);
    await expect(groqGenerateContent({ model: "m", contents: "本文" })).rejects.toThrow("GROQ_API_KEY");
  });
});
