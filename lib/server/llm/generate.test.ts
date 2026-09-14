import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Message } from "../types";

// 実 API は叩かない。generateContent を差し替えて、渡された引数と返り値の扱いを検証する
const { generateContent } = vi.hoisted(() => ({ generateContent: vi.fn() }));
vi.mock("./client", () => ({
  ai: { models: { generateContent } },
  GENERATION_MODEL: "test-model",
}));

import { generateReply } from "./generate";

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
  generateContent.mockResolvedValue({ text: "そうだね。" });
});

describe("generateReply: 会話だけをさせ、返答文をそのまま返す", () => {
  it("構造化出力は要求しない（主張の分解は extract、検査は evaluate に分けてある）", async () => {
    await generateReply(baseParams);
    const config = generateContent.mock.calls[0][0].config;
    expect(config.responseMimeType).toBeUndefined();
    expect(config.responseSchema).toBeUndefined();
  });

  it("返ってきた本文を trim して返す", async () => {
    generateContent.mockResolvedValue({ text: "  そうだね。\n" });
    expect(await generateReply(baseParams)).toBe("そうだね。");
  });

  it("text が空なら例外にし、握りつぶさない（pipeline 側の catch に任せる）", async () => {
    generateContent.mockResolvedValue({ text: "" });
    await expect(generateReply(baseParams)).rejects.toThrow();
  });
});

describe("generateReply: ペルソナと材料は systemInstruction に載せる", () => {
  it("作品名・視聴話数・canonFacts の説明・既存の嘘・差し戻し理由が system に入る", async () => {
    await generateReply({
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
    expect(system).toContain("A は B が好き");
    expect(system).toContain("C は D に住んでいる");
    expect(system).toContain("既存の嘘と矛盾している");
  });

  it("[プロンプトを短く保つ] strategy の選択肢・claims の記録規則・id はプロンプトに載せない", async () => {
    await generateReply({
      ...baseParams,
      canonFacts: [
        { id: "cf-1", workId: "w", episodeFrom: 1, subject: "A", relation: "likes", object: "B", description: "A は B が好き" },
      ],
    });
    const system: string = generateContent.mock.calls[0][0].config.systemInstruction;
    expect(system).not.toContain("strategy");
    expect(system).not.toContain("claims");
    expect(system).not.toContain("cf-1");
    expect(system).not.toContain("としお");
    expect(system.length).toBeLessThan(1500);
  });
});

describe("generateReply: 会話履歴を Gemini の contents 形式に変換する", () => {
  it("assistant は model に、user は user に写し、最後に今回の発言を user として足す", async () => {
    await generateReply({
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
    await generateReply({
      ...baseParams,
      history: [msg("user", "a"), msg("user", "b")],
    });
    const contents = generateContent.mock.calls[0][0].contents;
    expect(contents).toHaveLength(1);
    expect(contents[0]).toEqual({ role: "user", parts: [{ text: "a\nb\n1話どうだった？" }] });
  });

  it("履歴が model から始まるときはダミーの user を先頭に挿入する", async () => {
    await generateReply({
      ...baseParams,
      history: [msg("assistant", "先に話しかける")],
    });
    const contents = generateContent.mock.calls[0][0].contents;
    expect(contents[0].role).toBe("user");
    expect(contents[1]).toEqual({ role: "model", parts: [{ text: "先に話しかける" }] });
    expect(contents[contents.length - 1].role).toBe("user");
  });

  it("としおの発話（speaker=toshio）はシオリの会話ではないので履歴から落とす", async () => {
    await generateReply({
      ...baseParams,
      history: [
        msg("user", "これって伏線じゃない？"),
        { ...msg("assistant", "そうだね。"), speaker: "shiori" },
        { ...msg("assistant", "結論から言うとね……"), speaker: "toshio" },
      ],
    });
    const contents = generateContent.mock.calls[0][0].contents;
    expect(contents).toEqual([
      { role: "user", parts: [{ text: "これって伏線じゃない？" }] },
      { role: "model", parts: [{ text: "そうだね。" }] },
      { role: "user", parts: [{ text: "1話どうだった？" }] },
    ]);
  });

  it("履歴が空なら今回の発言だけを user として送る", async () => {
    await generateReply(baseParams);
    expect(generateContent.mock.calls[0][0].contents).toEqual([
      { role: "user", parts: [{ text: "1話どうだった？" }] },
    ]);
  });
});
