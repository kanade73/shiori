import { describe, expect, it } from "vitest";
import { buildNormalizer } from "./claims";
import { contentWords, matchSourceClauses, paraphraseMatches, sourceClauses, wordsInOrder } from "./grounding";
import type { ClaimRelation, Entity, SourceChunk } from "./types";

// 実際の会話で「古本屋！」への本当の返答（ピンク色の体・カニのハサミみたいなカチューシャ）が
// 嘘と判定された件の再現。事実と資料の段落は、そのとき資料係が作ったもの・引いたものをそのまま使う。

const entities: Entity[] = [
  { id: "e-1", workId: "w", name: "古本屋", aliases: [] },
  { id: "e-2", workId: "w", name: "モモンガ", aliases: [] },
  { id: "e-3", workId: "w", name: "ちいかわ", aliases: ["ちい"] },
];
const normalize = buildNormalizer(entities);
const names = (text: string) =>
  entities.filter((e) => [e.name, ...e.aliases].some((form) => text.includes(form))).map((e) => e.name);

const chunk: SourceChunk = {
  id: "src1-62",
  sourceTitle: "記事",
  url: "https://example.com",
  heading: "登場キャラクター / サブキャラクター",
  label: "古本屋",
  text: [
    "古本屋",
    "声 - 春海百乃",
    "耳のようなカニのハサミのカチューシャが特徴のピンク色のキャラクター。元は2020年8月29日更新回で初登場した古本屋を営むグレーの子（モブ）であり、小さく短い耳のついたグレーのシルエットで描かれていたが、2023年1月24日更新回から現在の姿で描かれている。グレーの子達の中で、初めてシルエットではない特有の姿が描かれたキャラクターである。",
    "性格は内気で恥ずかしがり屋。基本的に無口だが「クスクス」や「フフッ」っと静かに笑うことが多い。モモンガとはモブの頃から面識があり、「古本屋兼モモンガの友達」というポジションだった。モモンガの強い自我に押されることが多々あるものの、内心嫌ってはいない様子。",
    "討伐時の武器は、ちいかわたちのものと色違いの灰色のさすまた。モブ時代の体色に近い色をしている。ハムチーズマヨパンをお昼休憩に持参し、モモンガの頭から生えたキノコでカレーチャーハンを作る。",
  ].join("\n"),
};
const clauses = sourceClauses([chunk], names, normalize);

function claim(object: string, relation: ClaimRelation = "has", subject = "古本屋", negated = false) {
  return { subject, relation, object, negated };
}

describe("contentWords: object を内容語に分け、言い換えで入れ替わる機能語を落とす", () => {
  it("「みたいな」「の」は落ちる", () => {
    expect(contentWords("カニのハサミみたいなカチューシャ")).toEqual(["カニ", "ハサミ", "カチューシャ"]);
  });
  it("「のような」も落ちる", () => {
    expect(contentWords("耳のようなカニのハサミ")).toEqual(["耳", "カニ", "ハサミ"]);
  });
});

describe("wordsInOrder: 語がこの順で近くに並んでいるか", () => {
  it("間に少し挟まっていてもよい", () => {
    expect(wordsInOrder("耳のようなカニのハサミのカチューシャ", [["カニ"], ["ハサミ"], ["カチューシャ"]])).toBe(true);
  });
  it("順が逆なら一致しない", () => {
    expect(wordsInOrder("カチューシャが特徴のピンク色のキャラクター", [["ピンク色"], ["カチューシャ"]])).toBe(false);
  });
  it("離れすぎていれば一致しない", () => {
    expect(wordsInOrder("屋台の鎧さんに頼まれてから看板を書いた", [["屋台"], ["看板"]])).toBe(false);
  });
});

describe("paraphraseMatches: 本物の設定の言い換えを拾い、無い語が混ざれば拾わない", () => {
  const headband = ["耳のようなカニのハサミのカチューシャ", "耳のようなカニのハサミのカチューシャを特徴としている。"];
  const pink = ["ピンク色のキャラクター", "ピンク色の体をしたキャラクターである。"];

  it("本当の言い換えは一致する（実際に嘘と判定されていた2件）", () => {
    expect(paraphraseMatches("カニのハサミみたいなカチューシャ", headband, normalize)).toBe(true);
    expect(paraphraseMatches("ピンク色の体", pink, normalize)).toBe(true);
  });

  it("本物の設定に無い語が1つでも入れば一致しない（小さな嘘は嘘のまま）", () => {
    expect(paraphraseMatches("赤いカチューシャ", headband, normalize)).toBe(false);
    expect(paraphraseMatches("灰色のカチューシャ", headband, normalize)).toBe(false);
    expect(paraphraseMatches("青い体", pink, normalize)).toBe(false);
    expect(paraphraseMatches("ピンク色のうさぎ", pink, normalize)).toBe(false);
  });
});

describe("sourceClauses: 資料の段落を、主語付きの節に分ける", () => {
  it("主語を書かない節は、段落の見出し（キャラ名）について述べたものとする", () => {
    const shy = clauses.find((c) => c.text.includes("内気"));
    expect(shy?.subjects).toEqual(["古本屋"]);
  });

  it("他の登場人物が出てくる節は、その人物について述べたものとする", () => {
    const ego = clauses.find((c) => c.text.includes("強い自我"));
    expect(ego?.subjects).toEqual(["モモンガ"]);
  });

  it("否定を含む節は照合に使わない", () => {
    expect(clauses.some((c) => c.text.includes("シルエットではない"))).toBe(false);
    expect(clauses.some((c) => c.text.includes("嫌ってはいない"))).toBe(false);
  });

  it("段落の見出しそのものの行は節にしない", () => {
    expect(clauses.some((c) => c.text === "古本屋")).toBe(false);
  });
});

describe("matchSourceClauses: 事実に要約されなかった細部も、資料の節で本当と判定する", () => {
  it("資料に書かれた細部は一致する", () => {
    expect(matchSourceClauses(claim("ハムチーズマヨパンを持参", "did"), clauses, normalize)).toBe(true);
    expect(matchSourceClauses(claim("静かに笑う", "is"), clauses, normalize)).toBe(true);
    expect(matchSourceClauses(claim("カニのハサミみたいなカチューシャ"), clauses, normalize)).toBe(true);
  });

  it("別の人物について述べた節では一致しない（モモンガの強い自我は古本屋の性質ではない）", () => {
    expect(matchSourceClauses(claim("強い自我", "has"), clauses, normalize)).toBe(false);
    expect(matchSourceClauses(claim("強い自我", "has", "モモンガ"), clauses, normalize)).toBe(true);
  });

  it("節の中で語の順が違えば一致しない（ピンク色のカチューシャ）", () => {
    expect(matchSourceClauses(claim("ピンク色のカチューシャ"), clauses, normalize)).toBe(false);
  });

  it("否定の主張・関係そのものに意味がある関係は、資料の節では判定しない", () => {
    expect(matchSourceClauses(claim("ハムチーズマヨパンを持参", "did", "古本屋", true), clauses, normalize)).toBe(false);
    expect(matchSourceClauses(claim("モモンガの友達", "dislikes"), clauses, normalize)).toBe(false);
  });

  it("内容語が1語だけ・登場人物の名前だけの object は使わない（節にその語があるだけでは何を述べたか言えない）", () => {
    expect(matchSourceClauses(claim("カニ", "origin"), clauses, normalize)).toBe(false);
    expect(matchSourceClauses(claim("カニ", "is"), clauses, normalize)).toBe(false);
  });

  it("資料に無い細部は一致しない", () => {
    expect(matchSourceClauses(claim("小さな絆創膏", "has", "灰色のさすまた"), clauses, normalize)).toBe(false);
    expect(matchSourceClauses(claim("白い小さなシール"), clauses, normalize)).toBe(false);
  });
});
