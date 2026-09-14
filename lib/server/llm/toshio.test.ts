import { beforeEach, describe, expect, it, vi } from "vitest";

// 実 API は叩かない。generateContent を差し替えて、渡された引数と返り値の扱いを検証する
const { generateContent } = vi.hoisted(() => ({ generateContent: vi.fn() }));
vi.mock("./client", () => ({
  ai: { models: { generateContent } },
  GENERATION_MODEL: "test-model",
}));

import { generateToshioCommentary } from "./toshio";

const baseParams = {
  workTitle: "テスト作品",
  currentEpisode: 3,
  canonFacts: [],
  fabricatedFacts: [],
  userMessage: "これって伏線じゃない？",
  shioriMessage: "そうかもね。",
};

beforeEach(() => {
  generateContent.mockReset();
});

describe("generateToshioCommentary: Gemini の JSON 出力を ToshioCommentary として返す", () => {
  it("responseMimeType を JSON にして構造化出力を要求する", async () => {
    generateContent.mockResolvedValue({ text: JSON.stringify({ shouldComment: false, message: "" }) });
    await generateToshioCommentary(baseParams);
    const config = generateContent.mock.calls[0][0].config;
    expect(config.responseMimeType).toBe("application/json");
    expect(config.responseSchema).toBeDefined();
  });

  it("shouldComment=true のとき message をそのまま返す", async () => {
    const ok = { shouldComment: true, message: "結論から言うとね……" };
    generateContent.mockResolvedValue({ text: JSON.stringify(ok) });
    const result = await generateToshioCommentary(baseParams);
    expect(result).toEqual(ok);
  });

  it("shouldComment=false のときも例外にせずそのまま返す（呼び出し側が無視する）", async () => {
    const ok = { shouldComment: false, message: "" };
    generateContent.mockResolvedValue({ text: JSON.stringify(ok) });
    const result = await generateToshioCommentary(baseParams);
    expect(result).toEqual(ok);
  });

  it("スキーマに合わない JSON は例外にする", async () => {
    generateContent.mockResolvedValue({ text: JSON.stringify({ shouldComment: "yes" }) });
    await expect(generateToshioCommentary(baseParams)).rejects.toThrow();
  });
});
