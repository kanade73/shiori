import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Arc, SourceChunk } from "./types";

// issue #14: 会話の最初の返答から話題の場面を特定する流れ。外部の取得（sources）と
// 資料係の Gemini 呼び出し（llm/topic）は差し替え、段落の順位付け（rankChunks）は本物を通す。
const mocks = vi.hoisted(() => ({
  getSources: vi.fn(),
  getArcs: vi.fn(),
  getWork: vi.fn(),
  getEntities: vi.fn(),
  loadSourceChunks: vi.fn(),
  extractTopic: vi.fn(),
  rankChunksByVector: vi.fn(),
  ensureChunkEmbeddings: vi.fn(),
}));
vi.mock("./works", () => ({
  getSources: mocks.getSources,
  getArcs: mocks.getArcs,
  getWork: mocks.getWork,
  getEntities: mocks.getEntities,
}));
vi.mock("./sources", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./sources")>()),
  loadSourceChunks: mocks.loadSourceChunks,
}));
vi.mock("./llm/topic", () => ({ extractTopic: mocks.extractTopic }));
// ベクトル検索（埋め込み API）は差し替える。既定では「まだ埋め込みが揃っていない」（null）
vi.mock("./embeddings", () => ({
  rankChunksByVector: mocks.rankChunksByVector,
  ensureChunkEmbeddings: mocks.ensureChunkEmbeddings,
}));

import { episodeBoundaryFor, lookupSessionTopic, matchArc, prepareTopicSearch, selectCandidates } from "./topic";

const kenteiArc: Arc = {
  id: "arc-kentei",
  workId: "w",
  title: "草むしり検定編",
  episodeFrom: 57,
  episodeTo: 63,
  aliases: ["草むしり検定編", "検定編"],
};
const tsueArc: Arc = { id: "arc-tsue", workId: "w", title: "ふしぎな杖編", episodeFrom: 36, episodeTo: 39, aliases: ["杖編"] };

function chunk(overrides: Partial<SourceChunk>): SourceChunk {
  return { id: "c", sourceTitle: "記事", url: "https://example.org/wiki/記事", heading: "", label: "", text: "", ...overrides };
}

const chunks = [
  chunk({ id: "src1-1", label: "『草むしり検定』編", text: "ちいかわとハチワレが草むしり検定を受ける。合格したのはハチワレだけだった。" }),
  chunk({ id: "src1-2", label: "『杖』編", text: "うさぎが買ってきた杖で、ハチワレがカメラを出す。" }),
  chunk({ id: "src1-3", label: "ハチワレ", text: "はちわれ猫がモチーフ。洞窟に住んでいる。" }),
];

function extraction(overrides: Record<string, unknown> = {}) {
  return {
    found: true,
    title: "草むしり検定編",
    summary: "ちいかわとハチワレが草むしり検定を受け、ハチワレだけが合格する。",
    chunkIds: ["src1-1"],
    facts: [
      { subject: "ハチワレ", relation: "did", object: "草むしり検定5級に合格", description: "ハチワレは検定に合格した。", chunkId: "src1-1" },
    ],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getSources.mockReturnValue([{ kind: "mediawiki", endpoint: "https://example.org/w/api.php", page: "記事" }]);
  mocks.getArcs.mockReturnValue([kenteiArc, tsueArc]);
  mocks.getWork.mockReturnValue({ id: "w", title: "テスト作品", episodeCount: 100, createdAt: "" });
  mocks.getEntities.mockReturnValue([]);
  mocks.loadSourceChunks.mockResolvedValue(chunks);
  mocks.extractTopic.mockResolvedValue(extraction());
  mocks.rankChunksByVector.mockResolvedValue(null);
});

describe("matchArc: 場面の名前から arc を引く", () => {
  it("資料の見出し（『〇〇』編）でも arc の名前・別名に一致すれば引ける", () => {
    expect(matchArc([kenteiArc, tsueArc], ["『草むしり検定』編"])?.id).toBe("arc-kentei");
    expect(matchArc([kenteiArc, tsueArc], ["『杖』編"])?.id).toBe("arc-tsue");
  });

  it("一致しなければ null", () => {
    expect(matchArc([kenteiArc, tsueArc], ["ハチワレ"])).toBeNull();
  });
});

describe("episodeBoundaryFor: 話題の場面から分かる視聴済み話数", () => {
  it("arc に対応すれば、その arc の最後の話", () => {
    expect(episodeBoundaryFor("w", { arcId: "arc-kentei" } as never)).toBe(63);
  });

  it("作品の話数を超えない", () => {
    mocks.getWork.mockReturnValue({ id: "w", title: "テスト作品", episodeCount: 60, createdAt: "" });
    expect(episodeBoundaryFor("w", { arcId: "arc-kentei" } as never)).toBe(60);
  });

  it("話題が無い・arc に対応しないなら 0", () => {
    expect(episodeBoundaryFor("w", null)).toBe(0);
    expect(episodeBoundaryFor("w", { title: "ハチワレ" } as never)).toBe(0);
  });
});

describe("selectCandidates: 資料係に渡す段落を選ぶ", () => {
  const [a, b, c] = chunks;

  it("文字で十分に重なれば、bigram とベクトルの順位を混ぜる", () => {
    const picked = selectCandidates(
      [
        { chunk: a, score: 20 },
        { chunk: c, score: 1 },
      ],
      [
        { chunk: b, score: 0.7 },
        { chunk: a, score: 0.68 },
      ],
    );
    expect(picked[0].id).toBe("src1-1");
    expect(picked.map((x) => x.id).sort()).toEqual(["src1-1", "src1-2", "src1-3"]);
  });

  it("文字でほとんど重ならなければ、bigram の偶然の重なりは混ぜず、意味の近い段落だけ", () => {
    const picked = selectCandidates(
      [{ chunk: c, score: 2 }],
      [
        { chunk: b, score: 0.7 },
        { chunk: a, score: 0.6 },
      ],
    );
    expect(picked.map((x) => x.id)).toEqual(["src1-2"]);
  });

  it("ベクトル検索がまだ使えなければ、これまでどおり bigram だけ（足りなければ空）", () => {
    expect(selectCandidates([{ chunk: a, score: 5 }], null).map((x) => x.id)).toEqual(["src1-1"]);
    expect(selectCandidates([{ chunk: a, score: 2 }], null)).toEqual([]);
  });

  it("資料係に渡すのは最大8段落（文脈を増やさない）", () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ chunk: chunk({ id: `m${i}` }), score: 10 + i }));
    expect(selectCandidates(many, many.map((r) => ({ ...r, score: 0.7 })))).toHaveLength(8);
  });
});

describe("lookupSessionTopic: ユーザーの答えから話題の場面を特定する", () => {
  it("関係しそうな段落を資料係に渡し、特定した場面と事実をセッションの話題にする", async () => {
    const topic = await lookupSessionTopic({ workId: "w", workTitle: "テスト作品", userMessage: "草むしり検定のところ" });

    const passed: SourceChunk[] = mocks.extractTopic.mock.calls[0][0].chunks;
    expect(passed[0].id).toBe("src1-1");
    expect(mocks.extractTopic.mock.calls[0][0]).toMatchObject({ workTitle: "テスト作品", userMessage: "草むしり検定のところ" });

    expect(topic).toMatchObject({
      title: "草むしり検定編",
      summary: "ちいかわとハチワレが草むしり検定を受け、ハチワレだけが合格する。",
      arcId: "arc-kentei",
      query: "草むしり検定のところ",
      sources: [{ title: "記事", url: "https://example.org/wiki/記事" }],
      // 話題の切り替わりの判定に使う
      chunkIds: ["src1-1"],
    });
    // 事実は本物の設定（CanonFact）の形で持つ。arc が分かればその始まりの話から見えるもの
    expect(topic?.facts).toEqual([
      {
        id: "topic-1-1",
        workId: "w",
        episodeFrom: 57,
        subject: "ハチワレ",
        relation: "did",
        object: "草むしり検定5級に合格",
        description: "ハチワレは検定に合格した。",
      },
    ]);
  });

  it("事実の id は話題ごとに分ける（何番目の話題か）", async () => {
    const topic = await lookupSessionTopic({ workId: "w", workTitle: "テスト作品", userMessage: "草むしり検定のところ", ordinal: 3 });
    expect(topic?.facts[0].id).toBe("topic-3-1");
  });

  it("検索語（query）が渡されたらそれで引き、資料係にも会話から補った話題として渡す", async () => {
    await lookupSessionTopic({ workId: "w", workTitle: "テスト作品", userMessage: "あれの話もしたい", query: "草むしり検定" });
    const args = mocks.extractTopic.mock.calls[0][0];
    expect(args.chunks[0].id).toBe("src1-1");
    expect(args).toMatchObject({ userMessage: "あれの話もしたい", query: "草むしり検定" });
  });

  it("ベクトル検索の順位があれば bigram と混ぜ、bigram では下の段落も資料係に渡る", async () => {
    // bigram では「杖」の段落は検定の話に重ならないが、ベクトルでは一番近い
    mocks.rankChunksByVector.mockResolvedValue([
      { chunk: chunks[1], score: 0.9 },
      { chunk: chunks[0], score: 0.8 },
      { chunk: chunks[2], score: 0.1 },
    ]);
    await lookupSessionTopic({ workId: "w", workTitle: "テスト作品", userMessage: "草むしり検定のところ" });
    const passed: SourceChunk[] = mocks.extractTopic.mock.calls[0][0].chunks;
    expect(passed.map((c) => c.id)).toContain("src1-2");
    expect(mocks.rankChunksByVector).toHaveBeenCalledWith("w", "草むしり検定のところ", chunks, 30);
  });

  it("文字では重ならない曖昧な言い方でも、意味の近い段落があれば資料係に渡す（issue #22）", async () => {
    mocks.rankChunksByVector.mockResolvedValue([
      { chunk: chunks[0], score: 0.7 },
      { chunk: chunks[1], score: 0.62 },
    ]);
    const topic = await lookupSessionTopic({ workId: "w", workTitle: "テスト作品", userMessage: "泣けるやつ" });
    expect(topic?.title).toBe("草むしり検定編");
    // 意味の近さが足りない段落（相づち程度の近さ）は渡さない
    const passed: SourceChunk[] = mocks.extractTopic.mock.calls[0][0].chunks;
    expect(passed.map((c) => c.id)).toEqual(["src1-1"]);
  });

  it("文字でも意味でも資料に近くない発話（挨拶など）では、資料係を呼ばない", async () => {
    mocks.rankChunksByVector.mockResolvedValue([{ chunk: chunks[2], score: 0.63 }]);
    expect(await lookupSessionTopic({ workId: "w", workTitle: "テスト作品", userMessage: "こんにちは" })).toBeNull();
    expect(mocks.extractTopic).not.toHaveBeenCalled();
  });

  it("arc に対応しない話題（人物など）の事実は、話数に関係なく見せる（episodeFrom=0）", async () => {
    mocks.extractTopic.mockResolvedValue(
      extraction({
        title: "ハチワレ",
        chunkIds: ["src1-3"],
        facts: [{ subject: "ハチワレ", relation: "lives_in", object: "洞窟", description: "ハチワレは洞窟に住む。", chunkId: "src1-3" }],
      }),
    );
    const topic = await lookupSessionTopic({ workId: "w", workTitle: "テスト作品", userMessage: "ハチワレの話" });
    expect(topic?.arcId).toBeUndefined();
    expect(topic?.facts[0].episodeFrom).toBe(0);
  });

  it("資料係が特定できなければ（found=false）null", async () => {
    mocks.extractTopic.mockResolvedValue(extraction({ found: false, title: "", facts: [] }));
    expect(await lookupSessionTopic({ workId: "w", workTitle: "テスト作品", userMessage: "ハチワレの話" })).toBeNull();
  });

  it("挨拶のように資料とほとんど重ならない発話では、資料係（Gemini）を呼ばない", async () => {
    expect(await lookupSessionTopic({ workId: "w", workTitle: "テスト作品", userMessage: "こんにちは" })).toBeNull();
    expect(mocks.extractTopic).not.toHaveBeenCalled();
  });

  it("外部の知識源が書かれていない作品は、取得も資料係も呼ばずに null", async () => {
    mocks.getSources.mockReturnValue([]);
    expect(await lookupSessionTopic({ workId: "w", workTitle: "テスト作品", userMessage: "草むしり検定のところ" })).toBeNull();
    expect(mocks.loadSourceChunks).not.toHaveBeenCalled();
    expect(mocks.extractTopic).not.toHaveBeenCalled();
  });

  it("資料係の失敗は例外にせず null（シオリはそのまま返事をし、次の発話でまた調べる）", async () => {
    mocks.extractTopic.mockRejectedValue(new Error("429"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await lookupSessionTopic({ workId: "w", workTitle: "テスト作品", userMessage: "草むしり検定のところ" })).toBeNull();
    spy.mockRestore();
  });
});

describe("prepareTopicSearch: セッションを作ったときに検索の準備をする", () => {
  it("資料を取ってきて、段落の埋め込みを裏で作り始める", async () => {
    prepareTopicSearch("w");
    await vi.waitFor(() => expect(mocks.ensureChunkEmbeddings).toHaveBeenCalledWith("w", chunks));
  });

  it("外部の知識源が無い作品では何もしない", () => {
    mocks.getSources.mockReturnValue([]);
    prepareTopicSearch("w");
    expect(mocks.loadSourceChunks).not.toHaveBeenCalled();
  });
});
