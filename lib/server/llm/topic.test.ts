import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SourceChunk } from "../types";

// issue #14: 資料係（話題の場面の特定）の Gemini 呼び出し。実 API は叩かない
const { generateContent } = vi.hoisted(() => ({ generateContent: vi.fn() }));
vi.mock("./client", () => ({
  ai: { models: { generateContent } },
  GENERATION_MODEL: "test-model",
}));

import { extractTopic } from "./topic";

const chunks: SourceChunk[] = [
  { id: "src1-1", sourceTitle: "記事", url: "u", heading: "連作エピソード", label: "『検定』編", text: "AとBが検定を受ける。" },
];

const fact = (chunkId: string) => ({ subject: "B", relation: "did", object: "検定に合格", description: "B は合格した。", chunkId });

function respond(body: Record<string, unknown>) {
  generateContent.mockResolvedValue({
    text: JSON.stringify({ found: true, title: "検定編", summary: "検定の話。", chunkIds: ["src1-1"], facts: [fact("src1-1")], ...body }),
  });
}

beforeEach(() => {
  generateContent.mockReset();
  respond({});
});

describe("extractTopic: 渡した資料だけから場面と事実を抜き出させる", () => {
  it("ユーザーの答えと、id・見出し付きの資料を渡し、構造化出力を要求する", async () => {
    await extractTopic({ workTitle: "テスト作品", userMessage: "検定のところ", chunks });
    const args = generateContent.mock.calls[0][0];
    const prompt: string = args.contents[0].parts[0].text;
    expect(prompt).toContain("検定のところ");
    expect(prompt).toContain("[src1-1]（記事 / 連作エピソード / 『検定』編）");
    expect(prompt).toContain("AとBが検定を受ける。");
    expect(args.config.responseMimeType).toBe("application/json");
    expect(args.config.systemInstruction).toContain("資料に書かれていることだけを使う");
  });

  it("結果をそのまま返す", async () => {
    const result = await extractTopic({ workTitle: "テスト作品", userMessage: "検定のところ", chunks });
    expect(result).toEqual({ found: true, title: "検定編", summary: "検定の話。", chunkIds: ["src1-1"], facts: [fact("src1-1")] });
  });

  it("渡していない段落を根拠にした事実・段落 id は捨てる", async () => {
    respond({ chunkIds: ["src1-1", "src9-9"], facts: [fact("src1-1"), fact("src9-9")] });
    const result = await extractTopic({ workTitle: "テスト作品", userMessage: "検定のところ", chunks });
    expect(result.chunkIds).toEqual(["src1-1"]);
    expect(result.facts).toEqual([fact("src1-1")]);
  });

  it("閉じた語彙に無い relation は受け付けない（矛盾判定に使えないため）", async () => {
    respond({ facts: [{ ...fact("src1-1"), relation: "受けた" }] });
    await expect(extractTopic({ workTitle: "テスト作品", userMessage: "検定のところ", chunks })).rejects.toThrow();
  });
});
