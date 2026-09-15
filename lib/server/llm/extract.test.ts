import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildNormalizer } from "../claims";
import type { CanonFact, Entity } from "../types";
import { EXTRACT_TIMEOUT_MS, extractClaims, extractEndpoint, groundClaims, matchCanonFacts, type ExtractedClaim } from "./extract";

// このブランチの抽出はローカルの推論サーバ専用。Gemini は経路ごと無いので、
// 実 API のモック（generateContent）も持たない。叩くのは fetch だけ。

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

describe("extractEndpoint", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("末尾の / を落とした URL を返す", () => {
    vi.stubEnv("EXTRACT_ENDPOINT", "http://localhost:8123/");
    expect(extractEndpoint()).toBe("http://localhost:8123");
  });

  it("未設定なら例外（Gemini に黙って逃げる経路は無い）", () => {
    vi.stubEnv("EXTRACT_ENDPOINT", "");
    expect(() => extractEndpoint()).toThrow("EXTRACT_ENDPOINT");
  });
});

describe("extractClaims: 取り出しは常にローカルの推論サーバ", () => {
  const fetchMock = vi.fn();
  let warn: ReturnType<typeof vi.spyOn>;

  function serverClaims(claims: unknown[]) {
    return { ok: true, status: 200, json: async () => ({ claims, latencyMs: 12 }) };
  }

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubEnv("EXTRACT_ENDPOINT", "http://localhost:8123/");
    vi.stubGlobal("fetch", fetchMock);
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warn.mockRestore();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("POST <endpoint>/extract に返答文とユーザー発言を投げ、本物の設定は載せない", async () => {
    fetchMock.mockResolvedValue(
      serverClaims([
        { subject: "ハチワレ", relation: "lives_in", object: "洞窟", negated: false, quote: "ハチワレは洞窟に住んでる" },
        { subject: "ハチワレ", relation: "did", object: "屋台の看板を書いた", negated: false },
      ]),
    );
    const { claims, backend, failed } = await extractClaims(params);

    expect(backend).toBe("local");
    expect(failed).toBeUndefined();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://localhost:8123/extract");
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body);
    expect(body).toMatchObject({ text: params.text, workTitle: params.workTitle, userMessage: params.userMessage });
    expect(init.body).not.toContain("cf-1");
    expect(init.body).not.toContain(canon().description);
    expect(init.signal).toBeInstanceOf(AbortSignal);

    // grounding は endpoint 側では決まらない。アプリが canonFacts と照合して付ける
    expect(claims.map((c) => c.grounding)).toEqual(["canon", "fabricated"]);
    expect(claims[0].sourceCanonFactIds).toEqual(["cf-1"]);
  });

  it("語彙外の relation はその1件だけ捨てる（残りは通す）", async () => {
    fetchMock.mockResolvedValue(
      serverClaims([
        { subject: "ハチワレ", relation: "住んでいる", object: "洞窟", negated: false },
        { subject: "ハチワレ", relation: "did", object: "屋台の看板を書いた", negated: false },
      ]),
    );
    const { claims } = await extractClaims(params);
    expect(claims.map((c) => c.relation)).toEqual(["did"]);
  });

  it("接続できなければ warn 1行 + claims 空（返答文は返るので会話は続く）", async () => {
    fetchMock.mockRejectedValue(new Error("fetch failed"));

    const { claims, backend, failed } = await extractClaims(params);
    expect(claims).toEqual([]);
    expect(backend).toBe("local");
    expect(failed).toBe(true);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("タイムアウト（abort）でも claims 空", async () => {
    fetchMock.mockImplementation((_url: string, init: { signal: AbortSignal }) => {
      return new Promise((_resolve, reject) => {
        init.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      });
    });

    vi.useFakeTimers();
    const pending = extractClaims(params);
    await vi.advanceTimersByTimeAsync(EXTRACT_TIMEOUT_MS + 1);
    const { claims, failed } = await pending;
    vi.useRealTimers();

    expect(claims).toEqual([]);
    expect(failed).toBe(true);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("不正な JSON・形違い・非 2xx でも claims 空", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError("Unexpected token");
      },
    });
    expect((await extractClaims(params)).claims).toEqual([]);

    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ result: "???" }) });
    expect((await extractClaims(params)).claims).toEqual([]);

    fetchMock.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });
    expect((await extractClaims(params)).claims).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(3);
  });

  it("返答文が空ならサーバを呼ばない", async () => {
    expect((await extractClaims({ ...params, text: "   " })).claims).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("EXTRACT_ENDPOINT が未設定なら例外（pipeline が claims 空として握る）", async () => {
    vi.stubEnv("EXTRACT_ENDPOINT", "");
    await expect(extractClaims(params)).rejects.toThrow("EXTRACT_ENDPOINT");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
