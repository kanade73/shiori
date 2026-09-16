import { describe, expect, it } from "vitest";
import { properNounCandidates } from "./morph";

// 本物の辞書（IPADIC）で切る。汎用の辞書にアニメの登場人物は無いので、割れて出てくる名前を
// 名詞の並びとしてつなぎ直せることと、一般名詞だけの並びを拾わないことを固定する。
describe("properNounCandidates: 発話の中の固有名詞らしい語", () => {
  it("漢字の名前（人名 + 人名、人名 + 一般、未知語 + 一般 + 接尾）をつなぐ", async () => {
    expect(await properNounCandidates("炭治郎と禰豆子の兄妹愛が最高")).toEqual(["炭治郎", "禰豆子"]);
    expect(await properNounCandidates("五条悟の領域展開")).toEqual(["五条悟"]);
    expect(await properNounCandidates("悟空とベジータ")).toEqual(["悟空", "ベジータ"]);
  });

  it("辞書に無いカタカナの語は未知語として拾う（カタカナは names.ts でも拾うので重なってよい）", async () => {
    expect(await properNounCandidates("ナックルとユピーの戦いは感動したよね")).toEqual(["ユピー"]);
    expect(await properNounCandidates("ルフィの覇気")).toEqual(["ルフィ"]);
  });

  it("一般名詞だけの並び（感動シーン・最終回・草むしり検定）は拾わない", async () => {
    expect(await properNounCandidates("最終回の感動シーンで泣いた")).toEqual([]);
    expect(await properNounCandidates("草むしり検定は良かった")).toEqual([]);
  });

  it("ひらがなだけの並びは拾わない（「ちいかわ」は「ちい」[人名]と割れる）", async () => {
    expect(await properNounCandidates("ちいかわがうさぎに会う")).toEqual([]);
  });

  it("同じ語は1回", async () => {
    expect(await properNounCandidates("炭治郎、炭治郎ってさ")).toEqual(["炭治郎"]);
  });
});
