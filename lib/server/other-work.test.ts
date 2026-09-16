import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SourceChunk } from "./types";

// issue #1 ナックルベンチのルート1: 「ナックルとユピー」を別の作品と見分ける2段（ゲート → 判定役）。
// 判定役（Gemini）と外部資料の取得は差し替える。
const mocks = vi.hoisted(() => ({
  judgeOtherWork: vi.fn(),
  loadSourceChunks: vi.fn(),
  getSources: vi.fn(),
}));
vi.mock("./llm/other-work", () => ({ judgeOtherWork: mocks.judgeOtherWork }));
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
  mocks.judgeOtherWork.mockResolvedValue({ otherWork: "" });
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

  it("見知らぬ語が無ければ、資料も判定役も見ない", async () => {
    expect(await detectOtherWork({ ...base, unknownNames: [] })).toBeNull();
    expect(mocks.loadSourceChunks).not.toHaveBeenCalled();
    expect(mocks.judgeOtherWork).not.toHaveBeenCalled();
  });

  it("見知らぬ語が資料で全部落ちれば、判定役を呼ばない（API を増やさない）", async () => {
    expect(await detectOtherWork({ ...base, userMessage: "ポシェットの鎧さん", unknownNames: ["ポシェット"] })).toBeNull();
    expect(mocks.judgeOtherWork).not.toHaveBeenCalled();
  });

  it("資料に無い語だけを判定役に渡し、別の作品ならその名前を返す", async () => {
    mocks.judgeOtherWork.mockResolvedValue({ otherWork: "HUNTER×HUNTER" });
    const result = await detectOtherWork({ ...base, unknownNames: ["ナックル", "ユピー"] });
    expect(mocks.judgeOtherWork).toHaveBeenCalledWith({
      workTitle: "ちいかわ",
      userMessage: base.userMessage,
      names: ["ナックル", "ユピー"],
    });
    expect(result).toEqual({ otherWork: "HUNTER×HUNTER", names: ["ナックル", "ユピー"] });
  });

  it("判定役が「本作の話」（空文字）なら null", async () => {
    expect(await detectOtherWork({ ...base, unknownNames: ["ナックル"] })).toBeNull();
  });

  it("外部の知識源が無い作品では、見知らぬ語をそのまま判定役に見せる", async () => {
    mocks.getSources.mockReturnValue([]);
    mocks.judgeOtherWork.mockResolvedValue({ otherWork: "HUNTER×HUNTER" });
    const result = await detectOtherWork({ ...base, unknownNames: ["ナックル"] });
    expect(mocks.loadSourceChunks).not.toHaveBeenCalled();
    expect(result?.otherWork).toBe("HUNTER×HUNTER");
  });

  it("判定役が失敗しても null（本作の話として続ける）", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.judgeOtherWork.mockRejectedValue(new Error("429"));
    expect(await detectOtherWork({ ...base, unknownNames: ["ナックル"] })).toBeNull();
  });
});

describe("namesMissingFromSources: 漢字・かな混じりの語は資料の本文に含まれていれば落とす", () => {
  it("資料に無い漢字の名前は残り、資料にある語（鎧さん）は落ちる", () => {
    expect(namesMissingFromSources(["炭治郎", "鎧さん"], [chunk("鎧さんにナックルダスターで撃退された。")])).toEqual(["炭治郎"]);
  });
});
