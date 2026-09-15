import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionTopic } from "../types";

// 話題の切り替わりの判定役。実 API は叩かない
const { generateContent } = vi.hoisted(() => ({ generateContent: vi.fn() }));
vi.mock("./client", () => ({
  ai: { models: { generateContent } },
  ROUTER_MODEL: "router-model",
}));

import { routeTopicShift } from "./router";

const topic = { title: "草むしり検定編", summary: "検定を受ける話。" } as SessionTopic;
const base = { workTitle: "テスト作品", topic, lastReply: "あの検定の回ね。", userMessage: "そういえばリボンの回も", candidateLabels: ["『ほめられリボン』編"] };

beforeEach(() => {
  generateContent.mockReset();
  generateContent.mockResolvedValue({ text: JSON.stringify({ shift: true, query: " ほめられリボン " }) });
});

describe("routeTopicShift", () => {
  it("シオリとは別の軽いモデルで、いまの話題・直前の返答・発話・見出しだけを渡す", async () => {
    await routeTopicShift(base);
    const args = generateContent.mock.calls[0][0];
    expect(args.model).toBe("router-model");
    const prompt: string = args.contents[0].parts[0].text;
    expect(prompt).toContain("草むしり検定編：検定を受ける話。");
    expect(prompt).toContain("あの検定の回ね。");
    expect(prompt).toContain("そういえばリボンの回も");
    expect(prompt).toContain("- 『ほめられリボン』編");
    expect(args.config.responseMimeType).toBe("application/json");
  });

  it("直前の返答が長ければ切って、文脈を小さく保つ", async () => {
    await routeTopicShift({ ...base, lastReply: "あ".repeat(500) });
    const prompt: string = generateContent.mock.calls[0][0].contents[0].parts[0].text;
    expect(prompt).toContain(`${"あ".repeat(200)}…`);
    expect(prompt).not.toContain("あ".repeat(201));
  });

  it("切り替えなら検索語を整えて返す", async () => {
    expect(await routeTopicShift(base)).toEqual({ shift: true, query: "ほめられリボン" });
  });

  it("続きなら検索語は空", async () => {
    generateContent.mockResolvedValue({ text: JSON.stringify({ shift: false, query: "何か" }) });
    expect(await routeTopicShift(base)).toEqual({ shift: false, query: "" });
  });
});
