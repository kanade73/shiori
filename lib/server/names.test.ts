import { describe, expect, it } from "vitest";
import { applyNameCorrections, editDistance, findNameCorrections, katakanaWords, toKatakana, unknownKatakanaWords } from "./names";
import type { Arc, Entity } from "./types";

// issue #1 ナックルベンチ: 「ハコワレ」（ハチワレの誤字）と「ナックル」「ユピー」（別の作品）を、
// 作品名・キャラ名をコードに書かずに見分ける。データは work.json の形をしたテスト用のもの。
function entity(name: string, aliases: string[] = []): Entity {
  return { id: name, workId: "w", name, aliases };
}
const entities: Entity[] = [
  entity("ちいかわ", ["ちいかわちゃん", "チイカワ"]),
  entity("ハチワレ", ["はちわれ", "ハチワレちゃん", "ハチ"]),
  entity("うさぎ", ["ウサギ", "うさぎちゃん"]),
  entity("モモンガ", ["もんが"]),
  entity("ラッコ", ["ラッコ先輩"]),
  entity("シーサー", []),
];
const arcs: Arc[] = [
  { id: "arc-kentei", workId: "w", title: "草むしり検定編", episodeFrom: 50, episodeTo: 60, aliases: ["草むしり検定"] },
  { id: "arc-pajama", workId: "w", title: "パジャマパーティーズ編", episodeFrom: 144, episodeTo: 155, aliases: ["パジャマパーティーズ"] },
];

describe("toKatakana / katakanaWords", () => {
  it("ひらがなをカタカナに寄せる（別名の表記ゆれを同じ語にする）", () => {
    expect(toKatakana("はちわれ")).toBe("ハチワレ");
    expect(toKatakana("ちいかわ")).toBe("チイカワ");
    expect(toKatakana("ﾊﾁﾜﾚ")).toBe("ハチワレ");
  });

  it("発話からカタカナの語だけを取る（長音を含む）", () => {
    expect(katakanaWords("草むしり検定はハコワレが頑張っていてとても良かった。")).toEqual(["ハコワレ"]);
    expect(katakanaWords("ナックルとユピーの戦いは感動したよね。")).toEqual(["ナックル", "ユピー"]);
    expect(katakanaWords("ちいかわがかわいい")).toEqual([]);
  });
});

describe("editDistance", () => {
  it("置換・脱字・余字はそれぞれ 1", () => {
    expect(editDistance("ハコワレ", "ハチワレ")).toBe(1);
    expect(editDistance("ハチワ", "ハチワレ")).toBe(1);
    expect(editDistance("ハチワレー", "ハチワレ")).toBe(1);
    expect(editDistance("ナックル", "ハチワレ", 1)).toBeGreaterThan(1);
  });
});

describe("findNameCorrections: 登場人物の名前の誤字", () => {
  it("ハコワレ → ハチワレ（ナックルベンチのルート1・2の1発話目）", () => {
    expect(findNameCorrections(entities, "草むしり検定はハコワレが頑張っていてとても良かった。")).toEqual([
      { written: "ハコワレ", entity: "ハチワレ" },
    ]);
  });

  it("正式名・別名そのものは誤字ではない", () => {
    expect(findNameCorrections(entities, "ハチワレとウサギが好き")).toEqual([]);
    expect(findNameCorrections(entities, "ラッコ先輩かっこいい")).toEqual([]);
  });

  it("ひらがなの名前にも、カタカナで書かれた1文字違いを対応づける", () => {
    expect(findNameCorrections(entities, "チイカヲが泣いてた")).toEqual([{ written: "チイカヲ", entity: "ちいかわ" }]);
  });

  it("別の作品の名前（どの登場人物からも遠い）は誤字にしない", () => {
    expect(findNameCorrections(entities, "ナックルとユピーの戦いは感動したよね。")).toEqual([]);
  });

  it("短い語（2文字）は誤字とみなさない", () => {
    expect(findNameCorrections(entities, "ハコが出てきた")).toEqual([]);
  });

  it("同じ語は1回だけ", () => {
    expect(findNameCorrections(entities, "ハコワレ、ハコワレってさ")).toHaveLength(1);
  });
});

describe("applyNameCorrections", () => {
  it("誤字を正式名に置き換えた文を返す（資料の検索に使う）", () => {
    const text = "草むしり検定はハコワレが頑張っていた";
    expect(applyNameCorrections(text, [{ written: "ハコワレ", entity: "ハチワレ" }])).toBe("草むしり検定はハチワレが頑張っていた");
  });
});

describe("unknownKatakanaWords: 作品の名前のどれでもないカタカナの語", () => {
  const base = { entities, arcs, workTitle: "ちいかわ" };

  it("ナックル・ユピーは見知らぬ語", () => {
    expect(unknownKatakanaWords({ ...base, userMessage: "ナックルとユピーの戦いは感動したよね。" })).toEqual(["ナックル", "ユピー"]);
  });

  it("登場人物・編の名前・作品名・その一部は見知らぬ語ではない", () => {
    expect(unknownKatakanaWords({ ...base, userMessage: "ハチワレとウサギがパジャマパーティーズで" })).toEqual([]);
    expect(unknownKatakanaWords({ ...base, userMessage: "パジャマがかわいい" })).toEqual([]);
    expect(unknownKatakanaWords({ ...base, userMessage: "チイカワの話" })).toEqual([]);
  });

  it("会話の一般語（アニメ・シーン・キャラなど）は見知らぬ語ではない", () => {
    expect(unknownKatakanaWords({ ...base, userMessage: "あのシーンのキャラのセリフがエモい" })).toEqual([]);
  });

  it("誤字と判定した語は見知らぬ語から外す", () => {
    expect(
      unknownKatakanaWords({
        ...base,
        userMessage: "ハコワレが頑張っていた",
        corrections: [{ written: "ハコワレ", entity: "ハチワレ" }],
      }),
    ).toEqual([]);
  });
});

describe("unknownKatakanaWords: 形態素解析で切り出した語（extraWords）", () => {
  const base = { entities, arcs, workTitle: "ちいかわ" };

  it("漢字の名前も見知らぬ語として通す", () => {
    expect(unknownKatakanaWords({ ...base, userMessage: "炭治郎と禰豆子が好き", extraWords: ["炭治郎", "禰豆子"] })).toEqual(["炭治郎", "禰豆子"]);
  });

  it("登場人物の名前の一部・誤字を含む並びは見知らぬ語ではない", () => {
    expect(
      unknownKatakanaWords({
        ...base,
        userMessage: "ハコワレ先輩とモモンガ",
        corrections: [{ written: "ハコワレ", entity: "ハチワレ" }],
        extraWords: ["ハコワレ先輩", "モモンガ"],
      }),
    ).toEqual([]);
  });

  it("カタカナの語と重なっても1回", () => {
    expect(unknownKatakanaWords({ ...base, userMessage: "ユピーの戦い", extraWords: ["ユピー"] })).toEqual(["ユピー"]);
  });
});
