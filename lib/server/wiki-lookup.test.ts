import { describe, expect, it } from "vitest";
import { pickWork, resolveWorkFromPages, type WikiPage } from "./wiki-lookup";

// 実際の ja.wikipedia の検索結果（記事名 + 冒頭1文）の形で、決定的な規則を固定する。通信はしない。
const page = (title: string, extract: string): WikiPage => ({ title, extract });

describe("resolveWorkFromPages", () => {
  it("A: 記事名「〇〇の登場人物」（単独の記事が無い脇役はこれで拾う）", () => {
    const pages = [page("山下明生", "山下 明生は、日本の児童文学作家。"), page("HUNTER×HUNTERの登場人物", "…")];
    expect(resolveWorkFromPages(pages, "ちいかわ")).toEqual({ work: "HUNTER×HUNTER", rule: "list" });
  });

  it("B: 冒頭文の「『〇〇』に登場する」「〇〇シリーズに登場する」", () => {
    expect(
      resolveWorkFromPages([page("ゾルディック家", "ゾルディック家（ゾルディックけ）は、冨樫義博の漫画『HUNTER×HUNTER』に登場する架空の暗殺者一家。")], "ちいかわ"),
    ).toEqual({ work: "HUNTER×HUNTER", rule: "appears_in" });
    expect(
      resolveWorkFromPages([page("ピカチュウ", "ピカチュウ（英:Pikachu）は、ポケットモンスターシリーズに登場する1025種のポケモンのうちの一種。")], "ちいかわ"),
    ).toEqual({ work: "ポケットモンスター", rule: "appears_in" });
  });

  it("C: 作品そのものの記事（上位3件まで）。記事名の括弧は落とす", () => {
    const pages = [page("鬼滅の刃 (アニメ)", "『鬼滅の刃』（きめつのやいば）は、吾峠呼世晴による同名の漫画を原作とする、ufotable制作の日本のテレビアニメシリーズ。")];
    expect(resolveWorkFromPages(pages, "ちいかわ")).toEqual({ work: "鬼滅の刃", rule: "work_article" });
    const low = [page("a", "a。"), page("b", "b。"), page("c", "c。"), page("リスのいたずら合戦", "『リスのいたずら合戦』は、日本の短編アニメ。")];
    expect(resolveWorkFromPages(low, "ちいかわ")).toBeNull();
  });

  it("A > B > C の優先（下位の一覧記事が、上位の人物記事より強い）", () => {
    const pages = [page("ナックル星人", "ナックル星人は、『帰ってきたウルトラマン』に登場する架空の宇宙人。"), page("HUNTER×HUNTERの登場人物", "…")];
    expect(resolveWorkFromPages(pages, "ちいかわ")?.work).toBe("HUNTER×HUNTER");
  });

  it("曖昧さ回避のページは読まない", () => {
    expect(resolveWorkFromPages([page("ナックル", "ナックル（英語: knuckle）は、以下のいずれかを指す。")], "ちいかわ")).toBeNull();
    expect(resolveWorkFromPages([page("ルフィ", "ルフィ  ルフィ - 旧約聖書の物語『ルツ記』の登場人物・ルツの表記。")], "ちいかわ")).toBeNull();
  });

  it("いまの作品に解けたら別の作品ではない（本作の脇役を検索すると本作の記事が返る）", () => {
    expect(resolveWorkFromPages([page("ちいかわ", "『ちいかわ』は、ナガノによる日本の漫画。")], "ちいかわ")).toBeNull();
  });

  it("どの規則にも当たらなければ null（一般名詞・地名）", () => {
    expect(resolveWorkFromPages([page("東京", "東京（とうきょう）は、関東地方の南西部にある、日本の首都。")], "ちいかわ")).toBeNull();
  });
});

describe("pickWork: 複数の語の多数決", () => {
  const hxh = { work: "HUNTER×HUNTER", rule: "list" as const };
  const ultra = { work: "帰ってきたウルトラマン", rule: "appears_in" as const };

  it("票の多い作品", () => {
    expect(pickWork([ultra, hxh, { ...hxh, rule: "appears_in" }])?.work).toBe("HUNTER×HUNTER");
  });

  it("同数なら強い規則で解けた方（ナックル→ウルトラマン[B] と ユピー→HUNTER×HUNTER[A]）", () => {
    expect(pickWork([ultra, hxh])?.work).toBe("HUNTER×HUNTER");
  });

  it("全部 null なら null", () => {
    expect(pickWork([null, null])).toBeNull();
  });
});
