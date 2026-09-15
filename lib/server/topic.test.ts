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

import { episodeBoundaryFor, lookupSessionTopic, matchArc } from "./topic";

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
    });
    // 事実は本物の設定（CanonFact）の形で持つ。arc が分かればその始まりの話から見えるもの
    expect(topic?.facts).toEqual([
      {
        id: "topic-1",
        workId: "w",
        episodeFrom: 57,
        subject: "ハチワレ",
        relation: "did",
        object: "草むしり検定5級に合格",
        description: "ハチワレは検定に合格した。",
      },
    ]);
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
