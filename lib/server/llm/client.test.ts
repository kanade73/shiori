import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// API キーは GEMINI_API_KEY（と2本目の GEMINI_API_KEY_2）だけから読む。NEXT_PUBLIC_ 経由でクライアントに漏らさない
describe("client: API キーの扱い", () => {
  beforeEach(() => {
    vi.stubEnv("GEMINI_API_KEY_2", "");
    delete (globalThis as { __geminiKeyRotation?: unknown }).__geminiKeyRotation;
    vi.resetModules();
  });
  afterEach(() => vi.unstubAllEnvs());

  it("GEMINI_API_KEY が無ければ空文字で初期化する（送信時に認証エラー → 定型文フォールバック）", async () => {
    const ctor = vi.fn();
    vi.doMock("@google/genai", () => ({ GoogleGenAI: ctor }));
    vi.stubEnv("GEMINI_API_KEY", "");
    const client = await import("./client");
    expect(ctor).toHaveBeenCalledWith({ apiKey: "" });
    expect(client.llmEnabled).toBe(false);
  });

  it("GEMINI_API_KEY を SDK にそのまま渡す", async () => {
    const ctor = vi.fn();
    vi.doMock("@google/genai", () => ({ GoogleGenAI: ctor }));
    vi.stubEnv("GEMINI_API_KEY", "test-key");
    await import("./client");
    expect(ctor).toHaveBeenCalledTimes(1);
    expect(ctor).toHaveBeenCalledWith({ apiKey: "test-key" });
  });

  it("GEMINI_API_KEY_2（先輩のキー）があれば SDK を2つ作る", async () => {
    const ctor = vi.fn();
    vi.doMock("@google/genai", () => ({ GoogleGenAI: ctor }));
    vi.stubEnv("GEMINI_API_KEY", "mine");
    vi.stubEnv("GEMINI_API_KEY_2", "senpai");
    await import("./client");
    expect(ctor.mock.calls).toEqual([[{ apiKey: "mine" }], [{ apiKey: "senpai" }]]);
  });

  it("自分のキーが 429 なら、ai.models.generateContent は先輩のキーで送り直す", async () => {
    const sent: string[] = [];
    vi.doMock("@google/genai", () => ({
      GoogleGenAI: vi.fn(function (this: { models: unknown }, { apiKey }: { apiKey: string }) {
        this.models = {
          generateContent: async () => {
            sent.push(apiKey);
            if (apiKey === "mine") throw Object.assign(new Error("quota"), { status: 429 });
            return { text: `from ${apiKey}` };
          },
        };
      }),
    }));
    vi.stubEnv("GEMINI_API_KEY", "mine");
    vi.stubEnv("GEMINI_API_KEY_2", "senpai");
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { ai } = await import("./client");
    const res = await ai.models.generateContent({ model: "gemini-3.5-flash-lite", contents: "やあ" });
    expect(res.text).toBe("from senpai");
    expect(sent).toEqual(["mine", "senpai"]);
  });
});
