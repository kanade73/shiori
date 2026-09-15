import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SourceChunk } from "./types";

// issue #14: 外部の知識源（MediaWiki）の取得・段落分け・検索。記事の取得は fetch を差し替え、
// どの記事を引くか・登場人物の別名は works を差し替えて与える（コードは作品を知らない）
const mocks = vi.hoisted(() => ({ getSources: vi.fn(), getEntities: vi.fn() }));
vi.mock("./works", () => mocks);

import { chunkArticle, clearSourceCache, fuseRankings, loadSourceChunks, mentionedNames, rankChunks } from "./sources";

const meta = { sourceTitle: "記事", url: "https://example.org/wiki/記事", idPrefix: "src1" };

function chunk(overrides: Partial<SourceChunk>): SourceChunk {
  return { id: "c", sourceTitle: "記事", url: "u", heading: "", label: "", text: "", ...overrides };
}

describe("chunkArticle: MediaWiki のプレーンテキストを段落に区切る", () => {
  const article = [
    "導入の段落。作品の概要が書いてある。",
    "== 連作エピソード ==",
    "この章では連作を示す。",
    "『検定』編",
    "AとBが検定を受ける。合格したのはBだけだった。",
    "『杖』編",
    "Cが買ってきた杖で、Bがカメラを出す。",
    "== 登場キャラクター ==",
    "=== 主要キャラクター ===",
    "A",
    "声 - 誰か",
    "主人公。泣き虫だが戦うと強い。",
    "== 脚注 ==",
    "出典の一覧。これは本文ではない。",
  ].join("\n");

  it("章の見出しと、短い行（『〇〇』編やキャラ名）を段落の見出しとして持つ", () => {
    const chunks = chunkArticle(article, meta);
    expect(chunks.map((c) => [c.heading, c.label])).toEqual([
      ["", ""],
      ["連作エピソード", ""],
      ["連作エピソード", "『検定』編"],
      ["連作エピソード", "『杖』編"],
      ["登場キャラクター / 主要キャラクター", "A"],
    ]);
    expect(chunks[2].text).toBe("『検定』編\nAとBが検定を受ける。合格したのはBだけだった。");
    // キャラ名の直後の短い行（声優）は同じ段落にまとめる
    expect(chunks[4].text).toBe("A\n声 - 誰か\n主人公。泣き虫だが戦うと強い。");
  });

  it("脚注・出典などの章は捨てる", () => {
    const chunks = chunkArticle(article, meta);
    expect(chunks.some((c) => c.text.includes("出典の一覧"))).toBe(false);
  });

  it("id は記事ごとの接頭辞つきの連番で、記事名と URL を持つ", () => {
    const chunks = chunkArticle(article, meta);
    expect(chunks.map((c) => c.id)).toEqual(["src1-1", "src1-2", "src1-3", "src1-4", "src1-5"]);
    expect(chunks[0]).toMatchObject({ sourceTitle: "記事", url: "https://example.org/wiki/記事" });
  });

  it("長い段落は見出しを引き継いで分割する", () => {
    const long = "あ".repeat(400) + "。";
    const chunks = chunkArticle(["== 章 ==", "見出し", long, long].join("\n"), meta);
    expect(chunks).toHaveLength(2);
    expect(chunks.every((c) => c.label === "見出し")).toBe(true);
  });

  it("短い行だけが続く一覧も、大きくなりすぎたら分割する", () => {
    const items = Array.from({ length: 60 }, (_, i) => `役職${i} - 名前${i}`);
    const chunks = chunkArticle(["== スタッフ ==", ...items].join("\n"), meta);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((c) => c.text.length <= 600)).toBe(true);
  });
});

describe("rankChunks: 発話と段落の文字 bigram の重なりで並べる", () => {
  const chunks = [
    chunk({ id: "kentei", label: "『草むしり検定』編", text: "ちいかわとハチワレが草むしり検定を受ける。" }),
    chunk({ id: "sukiyaki", label: "『すき焼き』編", text: "ちいかわがすき焼きセットを当てる。" }),
    chunk({ id: "usagi", label: "うさぎ", text: "ヤハと叫ぶ。" }),
    chunk({ id: "ramen", label: "『郎』編", text: "ラーメン店に入れない。" }),
  ];

  it("場面の名前が見出しに重なる段落が一番上に来る", () => {
    const ranked = rankChunks("草むしり検定のところ", chunks);
    expect(ranked[0].chunk.id).toBe("kentei");
  });

  it("重なりの無い段落は返さない", () => {
    const ranked = rankChunks("草むしり検定のところ", chunks);
    expect(ranked.map((r) => r.chunk.id)).not.toContain("ramen");
  });

  it("ひらがなだけの重なり（助詞など）は弱く数えるが、登場人物の名前として渡されたものは強く数える", () => {
    // 「すき」はすき焼きの段落に重なるが、うさぎの話
    const withoutNames = rankChunks("うさぎがすき", chunks);
    const withNames = rankChunks("うさぎがすき", chunks, ["うさぎ"]);
    expect(withNames[0].chunk.id).toBe("usagi");
    expect(withNames.find((r) => r.chunk.id === "usagi")!.score).toBeGreaterThan(
      withoutNames.find((r) => r.chunk.id === "usagi")!.score,
    );
  });

  it("別名で書かれていても、正式名を渡せばその段落が引ける", () => {
    const ranked = rankChunks("ウサちゃんの話", chunks, ["うさぎ"]);
    expect(ranked[0].chunk.id).toBe("usagi");
  });

  it("空の発話・空の資料は空", () => {
    expect(rankChunks("", chunks)).toEqual([]);
    expect(rankChunks("草むしり", [])).toEqual([]);
  });
});

describe("mentionedNames: 発話に出てきた登場人物の正式名", () => {
  it("別名でも正式名で返す", () => {
    mocks.getEntities.mockReturnValue([
      { id: "h", workId: "w", name: "ハチワレ", aliases: ["ハチ"] },
      { id: "u", workId: "w", name: "うさぎ", aliases: [] },
    ]);
    expect(mentionedNames("w", "ハチが洞窟にいる話")).toEqual(["ハチワレ"]);
  });
});

describe("loadSourceChunks: work.json の sources の記事を取ってくる", () => {
  const source = { kind: "mediawiki", endpoint: "https://example.org/w/api.php", page: "記事" };
  const fetchMock = vi.fn();

  function respond(body: unknown, status = 200) {
    fetchMock.mockResolvedValue(new Response(JSON.stringify(body), { status }));
  }

  beforeEach(() => {
    clearSourceCache();
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    mocks.getSources.mockReturnValue([source]);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("TextExtracts でプレーンテキストを取り、段落に区切って返す", async () => {
    respond({ query: { pages: [{ title: "記事", fullurl: "https://example.org/wiki/記事", extract: "== 章 ==\n本文の段落。" }] } });
    const chunks = await loadSourceChunks("w");
    expect(chunks).toEqual([
      { id: "src1-1", sourceTitle: "記事", url: "https://example.org/wiki/記事", heading: "章", label: "", text: "本文の段落。" },
    ]);

    const url = new URL(fetchMock.mock.calls[0][0]);
    expect(url.origin + url.pathname).toBe("https://example.org/w/api.php");
    expect(url.searchParams.get("titles")).toBe("記事");
    expect(url.searchParams.get("prop")).toBe("extracts|info");
    expect(url.searchParams.get("explaintext")).toBe("1");
    // Wikipedia は User-Agent の無い（汎用の）リクエストを弾くことがある
    expect(fetchMock.mock.calls[0][1].headers["User-Agent"]).toMatch(/misdirection-chat/);
  });

  it("一度取った記事はキャッシュし、セッションごとに取り直さない", async () => {
    respond({ query: { pages: [{ title: "記事", extract: "本文の段落。" }] } });
    await loadSourceChunks("w");
    await loadSourceChunks("w");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("取得に失敗しても例外にせず、空で返す", async () => {
    respond({}, 503);
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await loadSourceChunks("w")).toEqual([]);
    spy.mockRestore();
  });

  it("記事が無ければ空", async () => {
    respond({ query: { pages: [{ title: "記事", missing: true }] } });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await loadSourceChunks("w")).toEqual([]);
    spy.mockRestore();
  });

  it("sections が書かれていれば、その章と記事冒頭の導入だけを使う", async () => {
    mocks.getSources.mockReturnValue([{ ...source, sections: ["連作エピソード"] }]);
    respond({
      query: {
        pages: [
          {
            title: "記事",
            extract: "導入の段落。\n== 連作エピソード ==\n本編の段落。\n=== 前期 ===\n前期の段落。\n== コラボ ==\n商品の段落。",
          },
        ],
      },
    });
    const chunks = await loadSourceChunks("w");
    expect(chunks.map((c) => c.text)).toEqual(["導入の段落。", "本編の段落。", "前期の段落。"]);
  });

  it("sources が書かれていない作品は外部を引かない", async () => {
    mocks.getSources.mockReturnValue([]);
    expect(await loadSourceChunks("w")).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("fuseRankings: bigram とベクトルの順位を混ぜる", () => {
  const a = chunk({ id: "a" });
  const b = chunk({ id: "b" });
  const c = chunk({ id: "c" });

  it("点数の尺度ではなく順位で混ぜ、両方で上位のものが一番上に来る", () => {
    const fused = fuseRankings([
      [{ chunk: a, score: 50 }, { chunk: b, score: 40 }],
      [{ chunk: b, score: 0.9 }, { chunk: c, score: 0.8 }],
    ]);
    expect(fused.map((r) => r.chunk.id)).toEqual(["b", "a", "c"]);
  });

  it("片方にしか無い段落も残る（bigram では拾えない言い換えをベクトルが拾う）", () => {
    const fused = fuseRankings([[{ chunk: a, score: 10 }], [{ chunk: c, score: 0.9 }]]);
    expect(fused.map((r) => r.chunk.id).sort()).toEqual(["a", "c"]);
  });
});
