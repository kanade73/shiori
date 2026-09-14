import { beforeEach, describe, expect, it, vi } from "vitest";

const { generateContent } = vi.hoisted(() => ({ generateContent: vi.fn() }));
vi.mock("./client", () => ({
  ai: { models: { generateContent } },
  GENERATION_MODEL: "test-model",
}));

import { analyzeUserMessage } from "./analyze";

beforeEach(() => {
  generateContent.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("analyzeUserMessage", () => {
  it("Gemini の JSON 出力を UserMessageAnalysis として返す", async () => {
    generateContent.mockResolvedValue({
      text: JSON.stringify({
        mentionedCharacters: ["ハチワレ"],
        mentionedEvents: ["討伐"],
        sentiment: "positive",
        questionType: "impression",
      }),
    });
    const result = await analyzeUserMessage("ハチワレの討伐よかった");
    expect(result.mentionedCharacters).toEqual(["ハチワレ"]);
    expect(result.questionType).toBe("impression");
  });

  it("API が失敗しても例外にせず、空の解析結果に落とす（会話は止めない）", async () => {
    generateContent.mockRejectedValue(new Error("401"));
    const result = await analyzeUserMessage("なにか");
    expect(result).toEqual({
      mentionedCharacters: [],
      mentionedEvents: [],
      sentiment: "neutral",
      questionType: "other",
    });
  });

  it("questionType が語彙外でも空の解析結果に落とす", async () => {
    generateContent.mockResolvedValue({
      text: JSON.stringify({ mentionedCharacters: [], mentionedEvents: [], sentiment: "x", questionType: "??" }),
    });
    const result = await analyzeUserMessage("なにか");
    expect(result.questionType).toBe("other");
  });
});
