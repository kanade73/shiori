import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SourceChunk } from "./types";

// issue #1 ナックルベンチのルート1: 「ナックルとユピー」を別の作品と見分ける2段（ゲート → Wikipedia）。
// Wikipedia の検索と外部資料の取得は差し替える（pickWork は本物）。
const mocks = vi.hoisted(() => ({
  lookupWorkOfName: vi.fn(),
  loadSourceChunks: vi.fn(),
  getSources: vi.fn(),
}));
vi.mock("./wiki-lookup", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./wiki-lookup")>()),
  lookupWorkOfName: mocks.lookupWorkOfName,
}));
vi.mock("./sources", () => ({ loadSourceChunks: mocks.loadSourceChunks }));
vi.mock("./works", () => ({ getSources: mocks.getSources }));

import { detectOtherWork, namesMissingFromSources } from "./other-work";

function chunk(text: string, label = ""): SourceChunk {
  return { id: `c-${text.slice(0, 4)}`, sourceTitle: "記事", url: "", heading: "登場キャラクター", label, text };
}
const chunks = [
  chunk("ハチワレは草むしり検定に挑む。ポシェットの鎧さんが見守る。", "ハチワレ"),
  chunk("ゴブリンに捕まる回もある。", "『おっきい討伐』編"),
];

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getSources.mockReturnValue([{ kind: "mediawiki" }]);
  mocks.loadSourceChunks.mockResolvedValue(chunks);
  mocks.lookupWorkOfName.mockResolvedValue(null);
});

describe("namesMissingFromSources: 外部資料の本文に出てくる語は落とす", () => {
  it("資料にある語（脇役・用語）は本作の語彙、無い語だけ残る", () => {
    expect(namesMissingFromSources(["ポシェット", "ゴブリン", "ナックル", "ユピー"], chunks)).toEqual(["ナックル", "ユピー"]);
  });

  it("語ごとに見る。長い語の一部（ナックルダスター）に含まれるだけでは「資料にある」としない", () => {
    expect(namesMissingFromSources(["ナックル", "ダスター"], [chunk("鎧さんにナックルダスターで撃退された。")])).toEqual(["ナックル", "ダスター"]);
    expect(namesMissingFromSources(["ナックル"], [chunk("ナックルで殴る")])).toEqual([]);
  });
});

describe("detectOtherWork", () => {
  const base = { workId: "w", workTitle: "ちいかわ", userMessage: "ナックルとユピーの戦いは感動したよね。" };
  const hxh = { work: "HUNTER×HUNTER", rule: "list" as const };

  it("見知らぬ語が無ければ、資料も Wikipedia も見ない", async () => {
    expect(await detectOtherWork({ ...base, unknownNames: [] })).toBeNull();
    expect(mocks.loadSourceChunks).not.toHaveBeenCalled();
    expect(mocks.lookupWorkOfName).not.toHaveBeenCalled();
  });

  it("見知らぬ語が資料で全部落ちれば、Wikipedia に聞かない（通信を増やさない）", async () => {
    expect(await detectOtherWork({ ...base, userMessage: "ポシェットの鎧さん", unknownNames: ["ポシェット"] })).toBeNull();
    expect(mocks.lookupWorkOfName).not.toHaveBeenCalled();
  });

  it("資料に無い語だけを Wikipedia に聞き、別の作品ならその名前を返す", async () => {
    mocks.lookupWorkOfName.mockResolvedValue(hxh);
    const result = await detectOtherWork({ ...base, unknownNames: ["ナックル", "ユピー"] });
    expect(mocks.lookupWorkOfName).toHaveBeenCalledWith("ナックル", "ちいかわ");
    expect(mocks.lookupWorkOfName).toHaveBeenCalledWith("ユピー", "ちいかわ");
    expect(result).toEqual({ otherWork: "HUNTER×HUNTER", names: ["ナックル", "ユピー"] });
  });

  it("語ごとに解けた作品が割れたら多数決。同数なら強い規則（一覧記事）で解けた方", async () => {
    mocks.lookupWorkOfName.mockImplementation(async (word: string) =>
      word === "ナックル" ? { work: "帰ってきたウルトラマン", rule: "appears_in" } : hxh,
    );
    const result = await detectOtherWork({ ...base, unknownNames: ["ナックル", "ユピー"] });
    expect(result?.otherWork).toBe("HUNTER×HUNTER");
  });

  it("Wikipedia でどの語も解けなければ null（本作の話）", async () => {
    expect(await detectOtherWork({ ...base, unknownNames: ["ナックル"] })).toBeNull();
  });

  it("1発話で聞く語は3つまで", async () => {
    await detectOtherWork({ ...base, unknownNames: ["ア", "イ", "ウ", "エ", "オ"].map((c) => c + "ルファ") });
    expect(mocks.lookupWorkOfName).toHaveBeenCalledTimes(3);
  });

  it("外部の知識源が無い作品では、見知らぬ語をそのまま Wikipedia に聞く", async () => {
    mocks.getSources.mockReturnValue([]);
    mocks.lookupWorkOfName.mockResolvedValue(hxh);
    const result = await detectOtherWork({ ...base, unknownNames: ["ナックル"] });
    expect(mocks.loadSourceChunks).not.toHaveBeenCalled();
    expect(result?.otherWork).toBe("HUNTER×HUNTER");
  });
});

describe("namesMissingFromSources: 漢字・かな混じりの語は資料の本文に含まれていれば落とす", () => {
  it("資料に無い漢字の名前は残り、資料にある語（鎧さん）は落ちる", () => {
    expect(namesMissingFromSources(["炭治郎", "鎧さん"], [chunk("鎧さんにナックルダスターで撃退された。")])).toEqual(["炭治郎"]);
  });
});
