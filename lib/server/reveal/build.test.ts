import { describe, expect, it } from "vitest";
import { buildReveal, segmentContent, toRevealData } from "./build";
import type { CanonFact, FabricatedFact, Message, StoredClaim } from "../types";

function msg(id: string, role: Message["role"], content: string, speaker?: Message["speaker"]): Message {
  return { id, sessionId: "s1", role, content, createdAt: "2026-09-14T12:00:00.000Z", ...(speaker ? { speaker } : {}) };
}

function claim(id: string, grounding: StoredClaim["grounding"], quote: string, extra: Partial<StoredClaim> = {}): StoredClaim {
  return {
    id,
    subject: "ちいかわ",
    relation: "has",
    object: "何か",
    negated: false,
    claim: `${id} の主張`,
    grounding,
    sourceCanonFactIds: [],
    quote,
    ...extra,
  };
}

const canon: CanonFact = {
  id: "c1",
  workId: "w",
  episodeFrom: 7,
  subject: "ちいかわ",
  relation: "has",
  object: "資格",
  description: "ちいかわは草むしり検定に合格した",
};

describe("segmentContent", () => {
  it("quote の位置で本文を区切り、区切った部分に statementId を付ける", () => {
    const { segments } = segmentContent("資格を取った。裏にレシピがある。", [
      { id: "a", verdict: "true", quote: "資格を取った" },
      { id: "b", verdict: "lie", quote: "裏にレシピがある" },
    ]);
    expect(segments).toEqual([
      { text: "資格を取った", statementId: "a" },
      { text: "。" },
      { text: "裏にレシピがある", statementId: "b" },
      { text: "。" },
    ]);
  });

  it("重なる抜き出しは嘘を優先し、本当の方は位置なしになる", () => {
    const { segments, spans } = segmentContent("資格証の裏にレシピがある", [
      { id: "t", verdict: "true", quote: "資格証" },
      { id: "l", verdict: "lie", quote: "資格証の裏にレシピ" },
    ]);
    expect(spans.map((s) => s.statementId)).toEqual(["l"]);
    expect(segments).toEqual([{ text: "資格証の裏にレシピ", statementId: "l" }, { text: "がある" }]);
  });

  it("同じ quote が2回出てくるなら、2つ目の主張は2回目の出現に付く", () => {
    const { spans } = segmentContent("たぶんね。たぶんね。", [
      { id: "a", verdict: "lie", quote: "たぶんね" },
      { id: "b", verdict: "lie", quote: "たぶんね" },
    ]);
    expect(spans).toEqual([
      { start: 0, end: 4, statementId: "a" },
      { start: 5, end: 9, statementId: "b" },
    ]);
  });

  it("本文に無い quote や空の quote は位置なし。本文はそのまま1片で残る", () => {
    const { segments, spans } = segmentContent("そうだね。", [
      { id: "a", verdict: "lie", quote: "言い換えられた文" },
      { id: "b", verdict: "true", quote: null },
    ]);
    expect(spans).toEqual([]);
    expect(segments).toEqual([{ text: "そうだね。" }]);
  });
});

describe("buildReveal", () => {
  it("記録済みの claims から真偽を出し、根拠の canonFact を付ける。番号順は本文中の位置順", () => {
    const built = buildReveal({
      messages: [msg("u1", "user", "資格の話して"), msg("m1", "assistant", "資格を取った。裏にレシピがある。", "shiori")],
      messageClaims: {
        m1: [
          claim("lie1", "fabricated", "裏にレシピがある", { sourceCanonFactIds: ["c1"] }),
          claim("true1", "canon", "資格を取った", { sourceCanonFactIds: ["c1", "unseen"] }),
        ],
      },
      fabricatedFacts: [],
      canonFacts: [canon],
    });

    expect(built.statements.map((s) => [s.id, s.verdict])).toEqual([
      ["true1", "true"],
      ["lie1", "lie"],
    ]);
    // 視聴済み範囲に無い ID（unseen）は根拠に出さない
    expect(built.statements[0].sources).toEqual([{ id: "c1", episodeFrom: 7, description: "ちいかわは草むしり検定に合格した" }]);
    expect(built.messages[1].statementIds).toEqual(["true1", "lie1"]);
    expect(built.messages[0].segments).toEqual([{ text: "資格の話して" }]);
    expect(built.hasUntrackedMessages).toBe(false);
  });

  it("としおの発話には、直前のシオリの返答の嘘だけを前提として付ける", () => {
    const built = buildReveal({
      messages: [
        msg("m1", "assistant", "資格を取った。裏にレシピがある。", "shiori"),
        msg("t1", "assistant", "結論から言うとね。", "toshio"),
        msg("u2", "user", "へえ"),
        msg("m2", "assistant", "うん。"),
        msg("t2", "assistant", "要するにね。", "toshio"),
      ],
      messageClaims: {
        m1: [claim("lie1", "fabricated", "裏にレシピがある"), claim("true1", "canon", "資格を取った")],
        m2: [],
      },
      fabricatedFacts: [],
      canonFacts: [],
    });
    const toshio = built.messages.filter((m) => m.speaker === "toshio");
    expect(toshio.map((m) => m.premiseStatementIds)).toEqual([["lie1"], []]);
    expect(toshio[0].statementIds).toEqual([]);
  });

  it("claims の記録が無い旧データのシオリ発話は、保存済みの嘘だけを位置なしで出す", () => {
    const fake: FabricatedFact = {
      id: "fake1",
      sessionId: "s1",
      subject: "ちいかわ",
      relation: "has",
      object: "レシピ",
      negated: false,
      claim: "資格証の裏にレシピがある",
      sourceCanonFactIds: ["c1"],
      introducedMessageId: "old",
      confidence: 1,
      status: "active",
      createdAt: "",
    };
    const built = buildReveal({
      messages: [msg("old", "assistant", "裏にレシピがあるよ。")],
      messageClaims: {},
      fabricatedFacts: [fake],
      canonFacts: [canon],
    });
    expect(built.hasUntrackedMessages).toBe(true);
    expect(built.statements).toEqual([
      {
        id: "fake1",
        messageId: "old",
        verdict: "lie",
        claim: "資格証の裏にレシピがある",
        subject: "ちいかわ",
        relation: "has",
        object: "レシピ",
        negated: false,
        quote: null,
        sources: [{ id: "c1", episodeFrom: 7, description: "ちいかわは草むしり検定に合格した" }],
      },
    ]);
    expect(built.messages[0].segments).toEqual([{ text: "裏にレシピがあるよ。" }]);
  });
});

describe("toRevealData", () => {
  const built = buildReveal({
    messages: [msg("m1", "assistant", "資格を取った。裏にレシピがある。", "shiori")],
    messageClaims: { m1: [claim("lie1", "fabricated", "裏にレシピがある"), claim("x", "canon", "")] },
    fabricatedFacts: [],
    canonFacts: [],
  });

  it("答え合わせ前は問題だけを返し、真偽や本文の区切りを含めない", () => {
    const data = toRevealData(built, undefined);
    expect(data).toEqual({
      status: "pending",
      questions: [
        { id: "lie1", speaker: "shiori", text: "裏にレシピがある", createdAt: "2026-09-14T12:00:00.000Z" },
        // quote が無ければ主張の一文を出す
        { id: "x", speaker: "shiori", text: "x の主張", createdAt: "2026-09-14T12:00:00.000Z" },
      ],
    });
    expect(JSON.stringify(data)).not.toContain("verdict");
  });

  it("答え合わせ後は予想と真偽つきの会話を返す", () => {
    const reveal = { revealedAt: "2026-09-14T13:00:00.000Z", guesses: { lie1: "true" as const } };
    const data = toRevealData(built, reveal);
    expect(data.status).toBe("revealed");
    if (data.status !== "revealed") return;
    expect(data.reveal).toEqual(reveal);
    expect(data.statements.map((s) => s.verdict)).toEqual(["lie", "true"]);
    // 嘘の構造図も一緒に返す（主張2件 + 主語1件）
    expect(data.graph.nodes.map((n) => n.kind)).toEqual(["statement", "entity", "statement"]);
    expect(data.graph.edges.map((e) => e.kind)).toEqual(["subject", "subject"]);
  });
});
