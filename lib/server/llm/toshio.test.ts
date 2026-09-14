import { beforeEach, describe, expect, it, vi } from "vitest";

// 実 API は叩かない。generateContent を差し替えて、渡された引数と返り値の扱いを検証する
const { generateContent } = vi.hoisted(() => ({ generateContent: vi.fn() }));
vi.mock("./client", () => ({
  ai: { models: { generateContent } },
  GENERATION_MODEL: "test-model",
}));

import { generateToshioCommentary, markLies } from "./toshio";
import type { Claim } from "../types";

const baseParams = {
  workTitle: "テスト作品",
  currentEpisode: 3,
  canonFacts: [],
  fabricatedFacts: [],
  userMessage: "これって伏線じゃない？",
  shioriMessage: "そうかもね。",
  shioriLies: [] as Claim[],
};

function claim(overrides: Partial<Claim>): Claim {
  return {
    subject: "A",
    relation: "has",
    object: "B",
    negated: false,
    claim: "A は B を持っている",
    grounding: "fabricated",
    sourceCanonFactIds: [],
    ...overrides,
  };
}

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

describe("markLies: シオリの返答文の嘘の部分に印を付ける", () => {
  it("嘘の quote に当たる部分だけを【嘘】〜【/嘘】で囲む", () => {
    const { marked, unlocated } = markLies("ハチワレは頑張ってたね。夜遅くまで復習してたみたい。", [
      claim({ quote: "夜遅くまで復習してたみたい" }),
    ]);
    expect(marked).toBe("ハチワレは頑張ってたね。【嘘】夜遅くまで復習してたみたい【/嘘】。");
    expect(unlocated).toEqual([]);
  });

  it("複数の嘘はそれぞれ囲み、重なる・接する抜き出しは1つの印にまとめる", () => {
    const { marked } = markLies("ABCDEFGHIJ", [
      claim({ quote: "HI" }),
      claim({ quote: "BCD" }),
      claim({ quote: "CDE" }),
      claim({ quote: "F" }),
    ]);
    expect(marked).toBe("A【嘘】BCDEF【/嘘】G【嘘】HI【/嘘】J");
  });

  it("quote が無い・返答文に見つからない嘘は印を付けず unlocated に返す", () => {
    const paraphrased = claim({ quote: "言い換えられた文" });
    const noQuote = claim({ quote: undefined });
    const { marked, unlocated } = markLies("そうだね。", [paraphrased, noQuote]);
    expect(marked).toBe("そうだね。");
    expect(unlocated).toEqual([paraphrased, noQuote]);
  });
});

describe("generateToshioCommentary: シオリの返答のどこが嘘かをとしおに知らせる", () => {
  const lie = claim({ claim: "ハチワレは夜遅くまで復習していた", quote: "夜遅くまで復習してたみたい" });
  const lostLie = claim({ claim: "うさぎは参考書を持ち歩いている", quote: "本文に無い抜き出し" });

  async function contentsFor(params: Partial<typeof baseParams>) {
    generateContent.mockResolvedValue({ text: JSON.stringify({ shouldComment: false, message: "" }) });
    await generateToshioCommentary({ ...baseParams, ...params });
    const call = generateContent.mock.calls[0][0];
    return { text: call.contents[0].parts[0].text as string, system: call.config.systemInstruction as string };
  }

  it("シオリの返答は嘘の部分に印を付けて渡し、この返答でついた嘘も一覧で渡す", async () => {
    const { text } = await contentsFor({
      shioriMessage: "頑張ってたね。夜遅くまで復習してたみたい。",
      shioriLies: [lie, lostLie],
    });
    expect(text).toContain("頑張ってたね。【嘘】夜遅くまで復習してたみたい【/嘘】。");
    expect(text).toContain("- ハチワレは夜遅くまで復習していた\n");
    expect(text).toContain("- うさぎは参考書を持ち歩いている（本文中の位置は不明）");
  });

  it("嘘をついていない返答は印なしで渡し、嘘の一覧は「ついていない」と明示する", async () => {
    const { text } = await contentsFor({ shioriMessage: "そうだね。", shioriLies: [] });
    expect(text).toContain("ユーザーには印の無い文章が見えている）\nそうだね。\n");
    expect(text).toContain("（この返答では嘘をついていません）");
  });

  it("ペルソナで印の意味と、嘘だと明かさないことを指示する", async () => {
    const { system } = await contentsFor({});
    expect(system).toContain("【嘘】");
    expect(system).toContain("嘘だと明かしたり");
  });

  it("[ユーザーに見せない] としおが印を出力に写しても、返す前に取り除く", async () => {
    generateContent.mockResolvedValue({
      text: JSON.stringify({ shouldComment: true, message: "結論から言うとね、【嘘】夜遅くまで復習【/嘘】が鍵なんですよ。" }),
    });
    const result = await generateToshioCommentary(baseParams);
    expect(result.message).toBe("結論から言うとね、夜遅くまで復習が鍵なんですよ。");
  });
});
