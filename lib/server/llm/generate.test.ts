import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FabricatedFact, Message } from "../types";

// 実 API は叩かない。generateContent を差し替えて、渡された引数と返り値の扱いを検証する
const { generateContent } = vi.hoisted(() => ({ generateContent: vi.fn() }));
vi.mock("./client", () => ({
  ai: { models: { generateContent } },
  GENERATION_MODEL: "test-model",
}));

import { formatDirective, generateReply } from "./generate";

function msg(role: Message["role"], content: string): Message {
  return { id: `m-${content}`, sessionId: "s1", role, content, createdAt: "2026-01-01T00:00:00Z" } as Message;
}

function fact(claim: string): FabricatedFact {
  return {
    id: `ff-${claim}`,
    sessionId: "s1",
    subject: "C",
    relation: "lives_in",
    object: "D",
    negated: false,
    claim,
    sourceCanonFactIds: [],
    introducedMessageId: "m1",
    confidence: 0.6,
    status: "active",
    createdAt: "2026-01-01T00:00:00Z",
  };
}

const baseParams = {
  workTitle: "テスト作品",
  currentEpisode: 3,
  canonFacts: [],
  fabricatedFacts: [] as FabricatedFact[],
  directive: { kind: "introduce", phase: "early" } as const,
  history: [] as Message[],
  userMessage: "1話どうだった？",
};

beforeEach(() => {
  generateContent.mockReset();
  generateContent.mockResolvedValue({ text: "そうだね。" });
});

describe("generateReply: 生成は会話だけ（主張の分解は extract.ts が別に行う）", () => {
  it("構造化出力を使わず、返答文をそのまま返す", async () => {
    const result = await generateReply(baseParams);
    expect(result).toBe("そうだね。");
    const config = generateContent.mock.calls[0][0].config;
    expect(config.responseSchema).toBeUndefined();
    expect(config.responseMimeType).toBeUndefined();
  });

  it("前後の空白は落とし、空の出力は例外にする", async () => {
    generateContent.mockResolvedValue({ text: "  そうだね。  " });
    expect(await generateReply(baseParams)).toBe("そうだね。");
    generateContent.mockResolvedValue({ text: "" });
    await expect(generateReply(baseParams)).rejects.toThrow("Empty generation output");
  });

  it("[分離の要件] claims / quote / grounding の語をプロンプトに一切書かない", async () => {
    await generateReply(baseParams);
    const system: string = generateContent.mock.calls[0][0].config.systemInstruction;
    expect(system).not.toContain("claims");
    expect(system).not.toContain("claim");
    expect(system).not.toContain("quote");
    expect(system).not.toContain("grounding");
    expect(system).not.toContain("subject");
    expect(system).not.toContain("relation");
    expect(system).not.toContain("sourceCanonFactIds");
  });

  it("strategy / spoilerRisk もモデルには選ばせない", async () => {
    await generateReply(baseParams);
    const system: string = generateContent.mock.calls[0][0].config.systemInstruction;
    expect(system).not.toContain("strategy");
    expect(system).not.toContain("spoilerRisk");
  });
});

describe("generateReply: ペルソナと材料は systemInstruction に載せる", () => {
  it("作品名・視聴話数・canonFacts の説明・前に話したこと・今回の指示・差し戻し理由が入る", async () => {
    await generateReply({
      ...baseParams,
      canonFacts: [
        { id: "cf-1", workId: "w", episodeFrom: 1, subject: "A", relation: "likes", object: "B", description: "A は B が好き" },
      ],
      fabricatedFacts: [fact("C は D に住んでいる")],
      feedback: "既存の嘘と矛盾している",
    });
    const system: string = generateContent.mock.calls[0][0].config.systemInstruction;
    expect(system).toContain("テスト作品");
    expect(system).toContain("第3話まで");
    expect(system).toContain("A は B が好き");
    expect(system).toContain("C は D に住んでいる");
    expect(system).toContain(formatDirective({ kind: "introduce", phase: "early" }));
    expect(system).toContain("既存の嘘と矛盾している");
  });

  it("[企画の芯] 疑われても撤回しないことがペルソナに書かれている", async () => {
    await generateReply(baseParams);
    const system: string = generateContent.mock.calls[0][0].config.systemInstruction;
    expect(system).toContain("疑われたとき");
    expect(system).toContain("撤回しない");
  });

  it("[企画の芯] 嘘の作り方（発想は自由・具体的な細部）はペルソナに残っている", async () => {
    await generateReply(baseParams);
    const system: string = generateContent.mock.calls[0][0].config.systemInstruction;
    expect(system).toContain("嘘を作る際のルール");
    expect(system).toContain("発想は自由");
  });

  it("[ネタバレ防止は全廃] avoid_spoiler / ネタバレ をプロンプトに書かない", async () => {
    await generateReply(baseParams);
    const system: string = generateContent.mock.calls[0][0].config.systemInstruction;
    expect(system).not.toContain("avoid_spoiler");
    expect(system).not.toContain("ネタバレ");
  });
});

describe("formatDirective: バックエンドが決めた「今回の指示」の文面", () => {
  it("introduce は新しい設定を1つ混ぜるよう言う", () => {
    expect(formatDirective({ kind: "introduce", phase: "early" })).toContain("新しい設定を1つ");
  });

  it("plain は新しい設定を要求しない", () => {
    expect(formatDirective({ kind: "plain", phase: "early" })).toContain("新しい設定を要求しません");
  });

  it("layer は疑われた設定を列挙し、裏付けを足すよう言う", () => {
    const text = formatDirective({ kind: "layer", phase: "early", doubted: [fact("C は D に住んでいる")], detailCount: 1 });
    expect(text).toContain("- C は D に住んでいる");
    expect(text).toContain("撤回せず");
    expect(text).toContain("裏付ける新しい細部を1つ");
  });

  it("layer で疑われた設定を特定できなかったときは、直前に話した設定を裏付けるよう言う", () => {
    const text = formatDirective({ kind: "layer", phase: "early", doubted: [], detailCount: 1 });
    expect(text).toContain("直前に自分が話した設定");
    expect(text).toContain("撤回せず");
  });

  it("[エスカレーション] 終盤は足させる裏付けの数だけを増やす（内容には触れない）", () => {
    const late = formatDirective({ kind: "layer", phase: "late", doubted: [], detailCount: 3 });
    expect(late).toContain("裏付ける新しい細部を3つ");
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
