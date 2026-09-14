import { describe, expect, it, vi } from "vitest";

// API キーは GEMINI_API_KEY だけから読む。NEXT_PUBLIC_ 経由でクライアントに漏らさない
describe("client: API キーの扱い", () => {
  it("GEMINI_API_KEY が無ければ空文字で初期化する（送信時に認証エラー → 定型文フォールバック）", async () => {
    const ctor = vi.fn();
    vi.doMock("@google/genai", () => ({ GoogleGenAI: ctor }));
    vi.stubEnv("GEMINI_API_KEY", "");
    vi.resetModules();
    await import("./client");
    expect(ctor).toHaveBeenCalledWith({ apiKey: "" });
    vi.unstubAllEnvs();
  });

  it("GEMINI_API_KEY を SDK にそのまま渡す", async () => {
    const ctor = vi.fn();
    vi.doMock("@google/genai", () => ({ GoogleGenAI: ctor }));
    vi.stubEnv("GEMINI_API_KEY", "test-key");
    vi.resetModules();
    await import("./client");
    expect(ctor).toHaveBeenCalledWith({ apiKey: "test-key" });
    vi.unstubAllEnvs();
  });
});
