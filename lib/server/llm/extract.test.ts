import { beforeEach, describe, expect, it, vi } from "vitest";

const { generateContent } = vi.hoisted(() => ({ generateContent: vi.fn() }));
vi.mock("./client", () => ({
  ai: { models: { generateContent } },
  GENERATION_MODEL: "test-model",
}));

import { extractClaims } from "./extract";

const lie = {
  subject: "A",
  relation: "has",
  object: "赤い帽子",
  negated: false,
  claim: "A は赤い帽子を持っている",
  grounding: "fabricated",
  sourceCanonFactIds: [],
};

const baseParams = {
  workTitle: "テスト作品",
  message: "A は赤い帽子を持ってるよ。",
  canonFacts: [
    { id: "cf-1", workId: "w", episodeFrom: 1, subject: "A", relation: "likes", object: "B", description: "A は B が好き" },
  ],
};

beforeEach(() => {
  generateContent.mockReset();
  generateContent.mockResolvedValue({ text: JSON.stringify({ claims: [lie] }) });
});

describe("extractClaims: 返答文から主張を構造化出力で取り出す", () => {
  it("responseMimeType を JSON にし、relation を閉じた語彙で要求する", async () => {
    await extractClaims(baseParams);
    const config = generateContent.mock.calls[0][0].config;
    expect(config.responseMimeType).toBe("application/json");
    expect(config.responseSchema.properties.claims.items.properties.relation.enum).toContain("lives_in");
  });

  it("返ってきた claims を zod で検証して返す", async () => {
    expect(await extractClaims(baseParams)).toEqual([lie]);
  });

  it("返答文と、grounding 判定用の本物の設定（id 付き）を入力に入れる", async () => {
    await extractClaims(baseParams);
    const text: string = generateContent.mock.calls[0][0].contents[0].parts[0].text;
    expect(text).toContain("A は赤い帽子を持ってるよ。");
    expect(text).toContain("cf-1");
    expect(text).toContain("A は B が好き");
  });

  it("スキーマに合わない JSON（未知の relation）は例外にする", async () => {
    generateContent.mockResolvedValue({ text: JSON.stringify({ claims: [{ ...lie, relation: "owns" }] }) });
    await expect(extractClaims(baseParams)).rejects.toThrow(/Failed to parse claims output/);
  });
});
