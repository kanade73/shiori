import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// client.ts は読み込み時に環境変数からキーを組み立てるので、条件ごとに読み直す。

const generateContent = vi.fn();
const embedContent = vi.fn();

vi.mock("@google/genai", () => ({
  GoogleGenAI: class {
    models = { generateContent, embedContent };
  },
}));

const fetchMock = vi.fn();

function groqReply(text: string) {
  return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: text } }] }) };
}

/** Gemini の 429（枠切れ）。key-pool が「休ませる」と判定する形 */
function quotaError() {
  return Object.assign(new Error('{"error":{"code":429,"details":[{"quotaId":"GenerateRequestsPerDayPerProject"}]}}'), { status: 429 });
}

async function loadClient() {
  vi.resetModules();
  return import("./client");
}

const params = { model: "gemini-3.5-flash-lite", contents: [{ role: "user", parts: [{ text: "古本屋！" }] }] };

beforeEach(() => {
  generateContent.mockReset();
  embedContent.mockReset();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("ai.models.generateContent: Gemini が使えないときは Groq に逃がす", () => {
  it("GEMINI_API_KEY が入っていなければ、はじめから Groq に送る", async () => {
    vi.stubEnv("GEMINI_API_KEY", "");
    vi.stubEnv("GEMINI_API_KEY_2", "");
    vi.stubEnv("GROQ_API_KEY", "gsk_test");
    const { ai, llmEnabled } = await loadClient();

    fetchMock.mockResolvedValue(groqReply("そうだね。"));
    const result = await ai.models.generateContent(params);

    expect(llmEnabled).toBe(false);
    expect(result.text).toBe("そうだね。");
    expect(generateContent).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("枠切れ（429）で Gemini が失敗したら Groq に切り替える", async () => {
    vi.stubEnv("GEMINI_API_KEY", "AIza-test");
    vi.stubEnv("GEMINI_API_KEY_2", "");
    vi.stubEnv("GROQ_API_KEY", "gsk_test");
    const { ai } = await loadClient();

    generateContent.mockRejectedValue(quotaError());
    fetchMock.mockResolvedValue(groqReply("……今日は何について話したい?"));
    const result = await ai.models.generateContent(params);

    expect(result.text).toBe("……今日は何について話したい?");
    expect(generateContent).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("混雑（503）でも切り替える（キーを変えても直らないため）", async () => {
    vi.stubEnv("GEMINI_API_KEY", "AIza-test");
    vi.stubEnv("GROQ_API_KEY", "gsk_test");
    const { ai } = await loadClient();

    generateContent.mockRejectedValue(new Error('{"error":{"code":503,"status":"UNAVAILABLE"}}'));
    fetchMock.mockResolvedValue(groqReply("うん。"));
    expect((await ai.models.generateContent(params)).text).toBe("うん。");
  });

  it("スキーマ違反など、逃げても直らない失敗は投げ直す", async () => {
    vi.stubEnv("GEMINI_API_KEY", "AIza-test");
    vi.stubEnv("GROQ_API_KEY", "gsk_test");
    const { ai } = await loadClient();

    generateContent.mockRejectedValue(new Error('{"error":{"code":400,"message":"Invalid JSON payload"}}'));
    await expect(ai.models.generateContent(params)).rejects.toThrow("Invalid JSON payload");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("GROQ_API_KEY が無ければ今までどおり Gemini の失敗がそのまま出る", async () => {
    vi.stubEnv("GEMINI_API_KEY", "AIza-test");
    vi.stubEnv("GROQ_API_KEY", "");
    const { ai } = await loadClient();

    generateContent.mockRejectedValue(quotaError());
    await expect(ai.models.generateContent(params)).rejects.toThrow("429");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("Gemini が返るときは Groq を呼ばない", async () => {
    vi.stubEnv("GEMINI_API_KEY", "AIza-test");
    vi.stubEnv("GROQ_API_KEY", "gsk_test");
    const { ai } = await loadClient();

    generateContent.mockResolvedValue({ text: "本物の返答" });
    expect((await ai.models.generateContent(params)).text).toBe("本物の返答");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("ai.models.embedContent: 埋め込みは Groq に無いので逃がさない", () => {
  it("失敗はそのまま投げる（段落の検索が bigram だけになる）", async () => {
    vi.stubEnv("GEMINI_API_KEY", "AIza-test");
    vi.stubEnv("GROQ_API_KEY", "gsk_test");
    const { ai } = await loadClient();

    embedContent.mockRejectedValue(quotaError());
    await expect(ai.models.embedContent({ model: "gemini-embedding-001", contents: ["テスト"] })).rejects.toThrow("429");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
