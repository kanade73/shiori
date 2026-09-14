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

describe("generateToshioCommentary: シオリの語った内容を「前提」として渡す", () => {
  const canonFact = {
    id: "cf-1",
    workId: "w",
    episodeFrom: 2,
    subject: "A",
    relation: "likes",
    object: "B",
    description: "A は B が好き",
  };
  const lie = {
    id: "ff-1",
    sessionId: "s1",
    subject: "C",
    relation: "lives_in" as const,
    object: "D",
    negated: false,
    claim: "C は D に住んでいる",
    sourceCanonFactIds: [],
    introducedMessageId: "m0",
    confidence: 0.9,
    status: "active" as const,
    createdAt: "2026-01-01T00:00:00Z",
  };

  it("作品名・視聴話数・本物の設定・シオリの嘘・ユーザー発言・シオリの返答が contents に入る", async () => {
    generateContent.mockResolvedValue({ text: JSON.stringify({ shouldComment: false, message: "" }) });
    await generateToshioCommentary({
      ...baseParams,
      canonFacts: [canonFact],
      fabricatedFacts: [lie],
      userMessage: "Cってどこに住んでるの？",
      shioriMessage: "Dだよ。前にも言ったけど。",
    });
    const call = generateContent.mock.calls[0][0];
    const text: string = call.contents[0].parts[0].text;
    expect(text).toContain("テスト作品");
    expect(text).toContain("第3話まで");
    expect(text).toContain("A は B が好き");
    expect(text).toContain("C は D に住んでいる");
    expect(text).toContain("Cってどこに住んでるの？");
    expect(text).toContain("Dだよ。前にも言ったけど。");
  });

  it("シオリの嘘は「否定・訂正しない」指示つきで列挙し、ペルソナは systemInstruction に載せる", async () => {
    generateContent.mockResolvedValue({ text: JSON.stringify({ shouldComment: false, message: "" }) });
    await generateToshioCommentary({ ...baseParams, fabricatedFacts: [lie] });
    const call = generateContent.mock.calls[0][0];
    const text: string = call.contents[0].parts[0].text;
    const lieSectionStart = text.indexOf("否定・訂正しない");
    expect(lieSectionStart).toBeGreaterThan(-1);
    expect(text.indexOf("C は D に住んでいる")).toBeGreaterThan(lieSectionStart);
    const system: string = call.config.systemInstruction;
    expect(system).toContain("としお");
    expect(system).toContain("shouldComment");
  });

  it("text が空でも例外にして握りつぶさない（pipeline 側で「今回は割り込まない」に落とす）", async () => {
    generateContent.mockResolvedValue({ text: "" });
    await expect(generateToshioCommentary(baseParams)).rejects.toThrow();
  });
});
