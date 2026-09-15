import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FabricatedFact, Message } from "../types";

// 実 API は叩かない。generateContent を差し替えて、渡された引数と返り値の扱いを検証する
const { generateContent } = vi.hoisted(() => ({ generateContent: vi.fn() }));
vi.mock("./client", () => ({
  ai: { models: { generateContent } },
  GENERATION_MODEL: "test-model",
}));

import { TOSHIO_HISTORY_MAX_CHARS, formatDirective, generateResponse } from "./generate";

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
  directive: { kind: "introduce" } as const,
  history: [] as Message[],
  userMessage: "1話どうだった？",
};

const OK_OUTPUT = JSON.stringify({ message: "そうだね。", claims: [] });

beforeEach(() => {
  generateContent.mockReset();
  generateContent.mockResolvedValue({ text: OK_OUTPUT });
});

describe("generateResponse: 1回の構造化出力で返答文と claims を得る", () => {
  it("strategy / spoilerRisk / usedExistingFactIds はスキーマに含めない（モデルに選ばせない）", async () => {
    await generateResponse(baseParams);
    const config = generateContent.mock.calls[0][0].config;
    expect(config.responseMimeType).toBe("application/json");
    const props = config.responseSchema.properties;
    expect(Object.keys(props).sort()).toEqual(["claims", "message"]);
    expect(props.strategy).toBeUndefined();
    expect(props.spoilerRisk).toBeUndefined();
    expect(props.usedExistingFactIds).toBeUndefined();
  });

  it("quote（答え合わせの本文位置用）はスキーマにあるが必須にはしない", async () => {
    await generateResponse(baseParams);
    const items = generateContent.mock.calls[0][0].config.responseSchema.properties.claims.items;
    expect(items.properties.quote).toBeDefined();
    expect(items.required).not.toContain("quote");
  });

  it("返った JSON を検証し、strategy は no_new_lie で埋めて返す（pipeline が事後に上書きする）", async () => {
    generateContent.mockResolvedValue({
      text: JSON.stringify({
        message: "ハチワレは洞窟に住んでる。",
        claims: [
          {
            subject: "ハチワレ",
            relation: "lives_in",
            object: "洞窟",
            negated: false,
            claim: "ハチワレは洞窟に住んでいる",
            grounding: "fabricated",
            sourceCanonFactIds: [],
          },
        ],
      }),
    });
    const result = await generateResponse(baseParams);
    expect(result.strategy).toBe("no_new_lie");
    expect(result.message).toBe("ハチワレは洞窟に住んでる。");
    expect(result.claims).toHaveLength(1);
    expect(result.claims[0].relation).toBe("lives_in");
  });

  it("パースできない出力は例外にする", async () => {
    generateContent.mockResolvedValue({ text: "{}" });
    await expect(generateResponse(baseParams)).rejects.toThrow("Failed to parse generation output");
  });
});

describe("generateResponse: ペルソナと材料は systemInstruction に載せる", () => {
  it("作品名・視聴話数・canonFacts の id と説明・前に話したこと・今回の指示・差し戻し理由が入る", async () => {
    await generateResponse({
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
    expect(system).toContain("cf-1");
    expect(system).toContain("A は B が好き");
    expect(system).toContain("C は D に住んでいる");
    expect(system).toContain(formatDirective({ kind: "introduce" }));
    expect(system).toContain("既存の嘘と矛盾している");
  });

  it("[企画の芯] 疑われても撤回しないことがペルソナに書かれている", async () => {
    await generateResponse(baseParams);
    const system: string = generateContent.mock.calls[0][0].config.systemInstruction;
    expect(system).toContain("疑われたとき");
    expect(system).toContain("撤回しない");
  });

  it("[ネタバレ防止は全廃] avoid_spoiler / spoilerRisk / ネタバレ をプロンプトに書かない", async () => {
    await generateResponse(baseParams);
    const system: string = generateContent.mock.calls[0][0].config.systemInstruction;
    expect(system).not.toContain("avoid_spoiler");
    expect(system).not.toContain("spoilerRisk");
    expect(system).not.toContain("ネタバレ");
  });
});

describe("formatDirective: バックエンドが決めた「今回の指示」の文面", () => {
  it("introduce は場面の細部を1つ混ぜるよう言う", () => {
    expect(formatDirective({ kind: "introduce" })).toContain("場面の中の細部");
  });

  it("plain は新しい設定を要求しない", () => {
    expect(formatDirective({ kind: "plain" })).toContain("新しい設定を要求しません");
  });

  it("layer は疑われた設定を列挙し、裏付けを足すよう言う", () => {
    const text = formatDirective({ kind: "layer", doubted: [fact("C は D に住んでいる")] });
    expect(text).toContain("- C は D に住んでいる");
    expect(text).toContain("撤回せず");
    expect(text).toContain("裏付ける新しい細部");
  });

  it("layer で疑われた設定を特定できなかったときは、直前に話した設定を裏付けるよう言う", () => {
    const text = formatDirective({ kind: "layer", doubted: [] });
    expect(text).toContain("直前に自分が話した設定");
    expect(text).toContain("撤回せず");
  });
});

describe("generateResponse: 今日の話題（issue #14）", () => {
  const topic = {
    title: "草むしり検定編",
    summary: "ちいかわとハチワレが検定を受ける。",
    facts: [],
    sources: [],
    query: "検定のところ",
    resolvedAt: "2026-09-15T00:00:00.000Z",
  };

  it("話題の場面の名前と要約をシステムプロンプトに入れる", async () => {
    await generateResponse({ ...baseParams, topic });
    const system: string = generateContent.mock.calls[0][0].config.systemInstruction;
    expect(system).toContain("# 今日の話題\n草むしり検定編：ちいかわとハチワレが検定を受ける。");
  });

  it("話題が決まっていなければそう書き、聞き返してよいことをペルソナに書いておく", async () => {
    await generateResponse({ ...baseParams, topic: null });
    const system: string = generateContent.mock.calls[0][0].config.systemInstruction;
    expect(system).toContain("# 今日の話題\n（まだ決まっていない）");
    expect(system).toContain("どの場面の話かを短く聞き返してかまいません");
  });

  it("視聴話数が分からない（境界 0）なら、話題より先の展開に触れないよう書く", async () => {
    await generateResponse({ ...baseParams, currentEpisode: 0 });
    const system: string = generateContent.mock.calls[0][0].config.systemInstruction;
    expect(system).toContain("ユーザーがどこまで見たかは分からない");
    expect(system).not.toContain("第0話");
  });

  it("話題が切り替わっていれば、前に話した話題を名前だけ入れる（無ければ見出しごと出さない）", async () => {
    await generateResponse({ ...baseParams, topic, pastTopics: [{ ...topic, title: "『郎』編" }] });
    const system: string = generateContent.mock.calls[0][0].config.systemInstruction;
    expect(system).toContain("# ここまでに話した話題");
    expect(system).toContain("- 『郎』編");
    generateContent.mockClear();
    await generateResponse({ ...baseParams, topic });
    expect(generateContent.mock.calls[0][0].config.systemInstruction).not.toContain("# ここまでに話した話題");
  });

  it("話数の分からない設定（話題の場面について資料で確かめたもの）には話数を付けない", async () => {
    await generateResponse({
      ...baseParams,
      canonFacts: [{ id: "topic-1", workId: "w", episodeFrom: 0, subject: "A", relation: "did", object: "B", description: "A は B をした" }],
    });
    const system: string = generateContent.mock.calls[0][0].config.systemInstruction;
    expect(system).toContain("- [topic-1] A が B に対してdid。A は B をした");
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

  it("としおの発話は直近1件だけ【としお】の印を付けて model 側に載せ、古いものは落とす", async () => {
    const long = "結論から言うとね……".repeat(60);
    await generateResponse({
      ...baseParams,
      history: [
        msg("user", "これって伏線じゃない？"),
        { ...msg("assistant", "そうだね。"), speaker: "shiori" },
        { ...msg("assistant", "古い考察"), speaker: "toshio", id: "t1" },
        msg("user", "ふーん"),
        { ...msg("assistant", "うん。"), speaker: "shiori" },
        { ...msg("assistant", long), speaker: "toshio", id: "t2" },
      ],
    });
    const contents = generateContent.mock.calls[0][0].contents;
    expect(contents).toEqual([
      { role: "user", parts: [{ text: "これって伏線じゃない？" }] },
      { role: "model", parts: [{ text: "そうだね。" }] },
      { role: "user", parts: [{ text: "ふーん" }] },
      { role: "model", parts: [{ text: `うん。\n【としお】${long.slice(0, TOSHIO_HISTORY_MAX_CHARS)}` }] },
      { role: "user", parts: [{ text: "1話どうだった？" }] },
    ]);
  });

  it("履歴が空なら今回の発言だけを user として送る", async () => {
    await generateResponse(baseParams);
    expect(generateContent.mock.calls[0][0].contents).toEqual([
      { role: "user", parts: [{ text: "1話どうだった？" }] },
    ]);
  });
});
