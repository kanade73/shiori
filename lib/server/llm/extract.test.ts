import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildNormalizer } from "../claims";
import type { CanonFact, Entity } from "../types";

// 実 API は叩かない。generateContent を差し替えて、渡した引数と返り値の扱いを検証する
const { generateContent } = vi.hoisted(() => ({ generateContent: vi.fn() }));
vi.mock("./client", () => ({
  ai: { models: { generateContent } },
  GENERATION_MODEL: "test-generation-model",
  EXTRACTION_MODEL: "test-extraction-model",
}));

import { EXTRACT_TIMEOUT_MS, extractClaims, groundClaims, matchCanonFacts, type ExtractedClaim } from "./extract";

const entities: Entity[] = [
  { id: "e-1", workId: "w", name: "ハチワレ", aliases: ["はちわれ", "八割れ"] },
  { id: "e-2", workId: "w", name: "洞窟", aliases: ["ほら穴"] },
];
const normalize = buildNormalizer(entities);

function canon(overrides: Partial<CanonFact> = {}): CanonFact {
  return {
    id: "cf-1",
    workId: "w",
    episodeFrom: 1,
    subject: "ハチワレ",
    relation: "住んでいる",
    object: "洞窟",
    description: "ハチワレは洞窟に住んでいる",
    ...overrides,
  };
}

function triple(overrides: Partial<ExtractedClaim> = {}): ExtractedClaim {
  return { subject: "ハチワレ", relation: "lives_in", object: "洞窟", negated: false, ...overrides };
}

describe("matchCanonFacts: 三つ組が本物の設定を述べたものかをコードで判定する", () => {
  it("正規化した subject / object が一致すれば canon（canonFact の relation は自由記述なので比べない）", () => {
    expect(matchCanonFacts(triple(), [canon()], normalize).map((f) => f.id)).toEqual(["cf-1"]);
  });

  it("entities の別名は正式名に寄せてから照合する", () => {
    const matched = matchCanonFacts(triple({ subject: "はちわれ", object: "ほら穴" }), [canon()], normalize);
    expect(matched.map((f) => f.id)).toEqual(["cf-1"]);
  });

  it("canonFact の object が句のときは、その一部を述べていても一致とみなす", () => {
    const fact = canon({ id: "cf-2", relation: "モチーフにしている", object: "ハムスターなどの齧歯類" });
    const matched = matchCanonFacts(triple({ relation: "origin", object: "ハムスター" }), [fact], normalize);
    expect(matched.map((f) => f.id)).toEqual(["cf-2"]);
  });

  it("subject が違えば一致しない", () => {
    expect(matchCanonFacts(triple({ subject: "うさぎ" }), [canon()], normalize)).toEqual([]);
  });

  it("object が違えば一致しない", () => {
    expect(matchCanonFacts(triple({ object: "海" }), [canon()], normalize)).toEqual([]);
  });

  it("否定の主張は本物の設定の裏返しなので canon にしない", () => {
    expect(matchCanonFacts(triple({ negated: true }), [canon()], normalize)).toEqual([]);
  });

  it("canonFact の relation が閉じた語彙で書かれているときだけ relation も厳密に比べる", () => {
    const fact = canon({ relation: "lives_in" });
    expect(matchCanonFacts(triple({ relation: "lives_in" }), [fact], normalize).map((f) => f.id)).toEqual(["cf-1"]);
    expect(matchCanonFacts(triple({ relation: "origin" }), [fact], normalize)).toEqual([]);
  });
});

describe("groundClaims: grounding はモデルではなくコードが付ける", () => {
  it("canonFacts に一致すれば canon で、根拠の id を持つ", () => {
    const [claim] = groundClaims([triple({ claim: "ハチワレは洞窟に住んでいる" })], [canon()], normalize);
    expect(claim.grounding).toBe("canon");
    expect(claim.sourceCanonFactIds).toEqual(["cf-1"]);
  });

  it("一致しなければ fabricated（＝嘘として保存される）で、根拠は空", () => {
    const [claim] = groundClaims([triple({ object: "屋台", claim: "ハチワレは屋台に住んでいる" })], [canon()], normalize);
    expect(claim.grounding).toBe("fabricated");
    expect(claim.sourceCanonFactIds).toEqual([]);
  });

  it("canonFacts が空なら全部 fabricated", () => {
    const [claim] = groundClaims([triple()], [], normalize);
    expect(claim.grounding).toBe("fabricated");
  });

  it("claim 文が無ければ quote で埋める", () => {
    const [claim] = groundClaims([triple({ quote: "ハチワレは洞窟に住んでるよ" })], [], normalize);
    expect(claim.claim).toBe("ハチワレは洞窟に住んでるよ");
    expect(claim.quote).toBe("ハチワレは洞窟に住んでるよ");
  });

  it("subject か object が空の主張は捨てる", () => {
    expect(groundClaims([triple({ subject: "  " }), triple({ object: "" })], [], normalize)).toEqual([]);
  });
});

const params = {
  text: "ハチワレは洞窟に住んでる。あと屋台の看板を自分で書いたらしい。",
  workTitle: "テスト作品",
  canonFacts: [canon()],
  normalize,
  userMessage: "ハチワレってどこに住んでるの？",
};

describe("extractClaims", () => {
  beforeEach(() => {
    generateContent.mockReset();
    generateContent.mockResolvedValue({
      text: JSON.stringify({
        claims: [
          { subject: "ハチワレ", relation: "lives_in", object: "洞窟", negated: false, claim: "ハチワレは洞窟に住んでいる", quote: "ハチワレは洞窟に住んでる" },
          { subject: "ハチワレ", relation: "did", object: "屋台の看板を書いた", negated: false, claim: "ハチワレが屋台の看板を書いた", quote: "屋台の看板を自分で書いたらしい" },
        ],
      }),
    });
  });

  it("会話とは別のモデル（GEMINI_EXTRACT_MODEL）を使い、構造化出力で受け取る", async () => {
    await extractClaims(params);
    const call = generateContent.mock.calls[0][0];
    expect(call.model).toBe("test-extraction-model");
    expect(call.config.responseMimeType).toBe("application/json");
  });

  it("grounding / sourceCanonFactIds はモデルのスキーマに含めない（コードが決めるため）", async () => {
    await extractClaims(params);
    const props = generateContent.mock.calls[0][0].config.responseSchema.properties.claims.items.properties;
    expect(Object.keys(props).sort()).toEqual(["claim", "negated", "object", "quote", "relation", "subject"]);
  });

  it("返答文とユーザー発言を渡すが、本物の設定はプロンプトに載せない（返答文に無いことを補わせない）", async () => {
    await extractClaims(params);
    const input: string = generateContent.mock.calls[0][0].contents[0].parts[0].text;
    expect(input).toContain(params.text);
    expect(input).toContain(params.userMessage);
    expect(input).not.toContain("cf-1");
    expect(input).not.toContain(canon().description);
  });

  it("取り出した三つ組に、canonFacts との照合で grounding を付けて返す", async () => {
    const { claims, backend } = await extractClaims(params);
    expect(backend).toBe("gemini");
    expect(claims).toHaveLength(2);
    expect(claims[0].grounding).toBe("canon");
    expect(claims[0].sourceCanonFactIds).toEqual(["cf-1"]);
    expect(claims[1].grounding).toBe("fabricated");
  });

  it("返答文が空なら API を呼ばずに空配列", async () => {
    expect((await extractClaims({ ...params, text: "   " })).claims).toEqual([]);
    expect(generateContent).not.toHaveBeenCalled();
  });

  it("パースできない出力は例外にする（pipeline 側で握って claims 空にする）", async () => {
    generateContent.mockResolvedValue({ text: "not json" });
    await expect(extractClaims(params)).rejects.toThrow("Failed to parse claims output");
  });

  it("語彙外の relation はその1件だけ捨てる（残りは通す）", async () => {
    generateContent.mockResolvedValue({
      text: JSON.stringify({
        claims: [
          { subject: "ハチワレ", relation: "住んでいる", object: "洞窟", negated: false },
          { subject: "ハチワレ", relation: "did", object: "屋台の看板を書いた", negated: false },
        ],
      }),
    });
    const { claims } = await extractClaims(params);
    expect(claims.map((c) => c.relation)).toEqual(["did"]);
  });

  it("EXTRACT_ENDPOINT が無ければ fetch は呼ばない（Gemini のまま）", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { backend } = await extractClaims(params);
    expect(backend).toBe("gemini");
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});

describe("extractClaims: EXTRACT_ENDPOINT があれば自前の推論サーバを使う", () => {
  const fetchMock = vi.fn();

  function serverClaims(claims: unknown[]) {
    return { ok: true, status: 200, json: async () => ({ claims, latencyMs: 12 }) };
  }

  beforeEach(() => {
    generateContent.mockReset();
    generateContent.mockResolvedValue({
      text: JSON.stringify({
        claims: [{ subject: "ハチワレ", relation: "lives_in", object: "洞窟", negated: false, claim: "gemini が出した主張" }],
      }),
    });
    fetchMock.mockReset();
    vi.stubEnv("EXTRACT_ENDPOINT", "http://localhost:8123/");
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("POST <endpoint>/extract に返答文を投げ、Gemini は呼ばない", async () => {
    fetchMock.mockResolvedValue(
      serverClaims([
        { subject: "ハチワレ", relation: "lives_in", object: "洞窟", negated: false, quote: "ハチワレは洞窟に住んでる" },
        { subject: "ハチワレ", relation: "did", object: "屋台の看板を書いた", negated: false },
      ]),
    );
    const { claims, backend } = await extractClaims(params);

    expect(backend).toBe("local");
    expect(generateContent).not.toHaveBeenCalled();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://localhost:8123/extract");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toMatchObject({ text: params.text, workTitle: params.workTitle, userMessage: params.userMessage });
    expect(init.signal).toBeInstanceOf(AbortSignal);

    // grounding は endpoint 側では決まらない。アプリが canonFacts と照合して付ける
    expect(claims.map((c) => c.grounding)).toEqual(["canon", "fabricated"]);
  });

  it("語彙外の relation はサーバ経由でも捨てる", async () => {
    fetchMock.mockResolvedValue(
      serverClaims([
        { subject: "ハチワレ", relation: "住んでいる", object: "洞窟", negated: false },
        { subject: "ハチワレ", relation: "did", object: "屋台の看板を書いた", negated: false },
      ]),
    );
    const { claims } = await extractClaims(params);
    expect(claims.map((c) => c.relation)).toEqual(["did"]);
  });

  it("接続できなければ Gemini に切り替える（デモ当日にサーバが落ちていても会話は続く）", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    fetchMock.mockRejectedValue(new Error("fetch failed"));

    const { claims, backend } = await extractClaims(params);
    expect(backend).toBe("gemini");
    expect(generateContent).toHaveBeenCalledTimes(1);
    expect(claims[0].claim).toBe("gemini が出した主張");
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it("タイムアウト（abort）でも Gemini に切り替える", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    fetchMock.mockImplementation((_url: string, init: { signal: AbortSignal }) => {
      return new Promise((_resolve, reject) => {
        init.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      });
    });

    vi.useFakeTimers();
    const pending = extractClaims(params);
    await vi.advanceTimersByTimeAsync(EXTRACT_TIMEOUT_MS + 1);
    const { backend } = await pending;
    vi.useRealTimers();

    expect(backend).toBe("gemini");
    expect(generateContent).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it("不正な JSON（形が違う）でも Gemini に切り替える", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError("Unexpected token");
      },
    });
    expect((await extractClaims(params)).backend).toBe("gemini");

    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ result: "???" }) });
    expect((await extractClaims(params)).backend).toBe("gemini");

    fetchMock.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });
    expect((await extractClaims(params)).backend).toBe("gemini");
    expect(warn).toHaveBeenCalledTimes(3);
    warn.mockRestore();
  });

  it("サーバも Gemini も駄目なら例外（pipeline が claims 空として握る）", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    fetchMock.mockRejectedValue(new Error("fetch failed"));
    generateContent.mockRejectedValue(new Error("429"));
    await expect(extractClaims(params)).rejects.toThrow("429");
    warn.mockRestore();
  });

  it("返答文が空ならサーバも呼ばない", async () => {
    expect((await extractClaims({ ...params, text: "   " })).claims).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
