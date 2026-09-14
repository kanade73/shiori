import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Message } from "../types";

// 実 API は叩かない。generateContent を差し替えて、渡された引数と返り値の扱いを検証する
const { generateContent } = vi.hoisted(() => ({ generateContent: vi.fn() }));
vi.mock("./client", () => ({
  ai: { models: { generateContent } },
  GENERATION_MODEL: "test-model",
}));

import { generateResponse } from "./generate";

const okResult = {
  message: "そうだね。",
  strategy: "no_new_lie",
  claims: [],
  usedExistingFactIds: [],
  spoilerRisk: 0.1,
};

function msg(role: Message["role"], content: string): Message {
  return { id: `m-${content}`, sessionId: "s1", role, content, createdAt: "2026-01-01T00:00:00Z" } as Message;
}

const baseParams = {
  workTitle: "テスト作品",
  currentEpisode: 3,
  canonFacts: [],
  fabricatedFacts: [],
  history: [] as Message[],
  userMessage: "1話どうだった？",
};

beforeEach(() => {
  generateContent.mockReset();
  generateContent.mockResolvedValue({ text: JSON.stringify(okResult) });
});

describe("generateResponse: Gemini の JSON 出力を GenerationResult として返す", () => {
  it("responseMimeType を JSON にして構造化出力を要求する", async () => {
    await generateResponse(baseParams);
    const config = generateContent.mock.calls[0][0].config;
    expect(config.responseMimeType).toBe("application/json");
    expect(config.responseSchema).toBeDefined();
  });

  it("返ってきた JSON を zod で検証して返す", async () => {
    const result = await generateResponse(baseParams);
    expect(result).toEqual(okResult);
  });

  it("スキーマに合わない JSON（spoilerRisk が範囲外）は例外にする", async () => {
    generateContent.mockResolvedValue({ text: JSON.stringify({ ...okResult, spoilerRisk: 3 }) });
    await expect(generateResponse(baseParams)).rejects.toThrow(/Failed to parse generation output/);
  });

  it("text が空でも例外になり、握りつぶさない（pipeline 側の catch に任せる）", async () => {
    generateContent.mockResolvedValue({ text: "" });
    await expect(generateResponse(baseParams)).rejects.toThrow();
  });
});

describe("generateResponse: ペルソナと材料は systemInstruction に載せる", () => {
  it("作品名・視聴話数・canonFacts・既存の嘘・差し戻し理由が system に入る", async () => {
    await generateResponse({
      ...baseParams,
      canonFacts: [
        { id: "cf-1", workId: "w", episodeFrom: 1, subject: "A", relation: "likes", object: "B", description: "A は B が好き" },
      ],
      fabricatedFacts: [
        { id: "ff-1", sessionId: "s1", subject: "C", relation: "lives_in", object: "D", claim: "C は D に住んでいる" },
      ] as never,
      feedback: "既存の嘘と矛盾している",
    });
    const system: string = generateContent.mock.calls[0][0].config.systemInstruction;
    expect(system).toContain("テスト作品");
    expect(system).toContain("第3話まで");
    expect(system).toContain("cf-1");
    expect(system).toContain("ff-1");
    expect(system).toContain("既存の嘘と矛盾している");
  });
});

describe("generateResponse: 会話履歴を Gemini の contents 形式に変換する", () => {
  it("assistant は model に、user は user に写し、最後に今回の発言を user として足す", async () => {
    await generateResponse({
      ...baseParams,
      history: [msg("user", "こんにちは"), msg("assistant", "……どうも")],
    });
    const contents = generateContent.mock.calls[0][0].contents;
    expect(contents).toEqual([
      { role: "user", parts: [{ text: "こんにちは" }] },
      { role: "model", parts: [{ text: "……どうも" }] },
      { role: "user", parts: [{ text: "1話どうだった？" }] },
    ]);
  });

  it("連続する同一ロールは 1 つの parts にまとめる", async () => {
    await generateResponse({
      ...baseParams,
      history: [msg("user", "a"), msg("user", "b")],
    });
    const contents = generateContent.mock.calls[0][0].contents;
    expect(contents).toHaveLength(1);
    expect(contents[0]).toEqual({ role: "user", parts: [{ text: "a\nb\n1話どうだった？" }] });
  });

  it("履歴が model から始まるときはダミーの user を先頭に挿入する", async () => {
    await generateResponse({
      ...baseParams,
      history: [msg("assistant", "先に話しかける")],
    });
    const contents = generateContent.mock.calls[0][0].contents;
    expect(contents[0].role).toBe("user");
    expect(contents[1]).toEqual({ role: "model", parts: [{ text: "先に話しかける" }] });
    expect(contents[contents.length - 1].role).toBe("user");
  });

  it("履歴が空なら今回の発言だけを user として送る", async () => {
    await generateResponse(baseParams);
    expect(generateContent.mock.calls[0][0].contents).toEqual([
      { role: "user", parts: [{ text: "1話どうだった？" }] },
    ]);
  });
});
