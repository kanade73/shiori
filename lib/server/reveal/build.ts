import { buildRevealGraph } from "./graph";
import type { CanonFact, Entity, FabricatedFact, Message, StoredClaim } from "../types";
import type { RevealData, RevealMessage, RevealSegment, RevealState, RevealStatement } from "./types";

/**
 * 答え合わせ: 会話の終わりに、シオリの発話のどこが本当でどこが嘘だったかを明かす。
 *
 * 真偽の出どころは generate が返した claims の grounding（発話ごとに保存したもの）。
 * 本文中の位置は claim の quote で探す。としおの発言は主張を記録していないので、
 * 「直前のシオリの嘘を題材として渡されたうえで話を合わせていた」ことだけを示す
 * （toshio.ts の premises）。
 */
export type BuiltReveal = {
  messages: RevealMessage[];
  statements: RevealStatement[];
  hasUntrackedMessages: boolean;
};

type Span = { start: number; end: number; statementId: string };

/**
 * quote の位置で本文を区切る。重なる抜き出しは嘘を優先し、後から来た方は
 * 本文中の別の出現を探す（見つからなければ位置なしとして扱う）。
 */
export function segmentContent(
  content: string,
  statements: Pick<RevealStatement, "id" | "quote" | "verdict">[],
): { segments: RevealSegment[]; spans: Span[] } {
  const ordered = [...statements.filter((s) => s.verdict === "lie"), ...statements.filter((s) => s.verdict === "true")];
  const spans: Span[] = [];
  const overlaps = (start: number, end: number) => spans.some((s) => start < s.end && s.start < end);

  for (const s of ordered) {
    const quote = s.quote?.trim() ?? "";
    if (!quote) continue;
    let start = content.indexOf(quote);
    while (start >= 0 && overlaps(start, start + quote.length)) start = content.indexOf(quote, start + 1);
    if (start >= 0) spans.push({ start, end: start + quote.length, statementId: s.id });
  }
  spans.sort((a, b) => a.start - b.start);

  const segments: RevealSegment[] = [];
  let cursor = 0;
  for (const span of spans) {
    if (span.start > cursor) segments.push({ text: content.slice(cursor, span.start) });
    segments.push({ text: content.slice(span.start, span.end), statementId: span.statementId });
    cursor = span.end;
  }
  if (cursor < content.length || segments.length === 0) segments.push({ text: content.slice(cursor) });
  return { segments, spans };
}

function sourcesFor(ids: string[], canonById: Map<string, CanonFact>): RevealStatement["sources"] {
  return ids.flatMap((id) => {
    const fact = canonById.get(id);
    return fact ? [{ id: fact.id, episodeFrom: fact.episodeFrom, description: fact.description }] : [];
  });
}

export function buildReveal(params: {
  messages: Message[];
  messageClaims: Record<string, StoredClaim[]>;
  fabricatedFacts: FabricatedFact[];
  /** 視聴済み範囲の canonFacts だけを渡すこと（根拠の表示に使う。未視聴の設定を漏らさない） */
  canonFacts: CanonFact[];
}): BuiltReveal {
  const { messages, messageClaims, fabricatedFacts, canonFacts } = params;
  const canonById = new Map(canonFacts.map((c) => [c.id, c]));

  const statements: RevealStatement[] = [];
  const revealMessages: RevealMessage[] = [];
  let hasUntrackedMessages = false;

  for (const message of messages) {
    const base = {
      id: message.id,
      role: message.role,
      ...(message.speaker ? { speaker: message.speaker } : {}),
      content: message.content,
      createdAt: message.createdAt,
    };

    if (message.role === "user") {
      revealMessages.push({ ...base, segments: [{ text: message.content }], statementIds: [] });
      continue;
    }

    if (message.speaker === "toshio") {
      const prev = revealMessages[revealMessages.length - 1];
      const premiseStatementIds =
        prev && prev.role === "assistant" && prev.speaker !== "toshio"
          ? prev.statementIds.filter((id) => statements.find((s) => s.id === id)?.verdict === "lie")
          : [];
      revealMessages.push({ ...base, segments: [{ text: message.content }], statementIds: [], premiseStatementIds });
      continue;
    }

    const recorded = messageClaims[message.id];
    let own: RevealStatement[];
    if (recorded) {
      own = recorded.map((c) => ({
        id: c.id,
        messageId: message.id,
        verdict: c.grounding === "fabricated" ? "lie" : "true",
        claim: c.claim,
        subject: c.subject,
        relation: c.relation,
        object: c.object,
        negated: c.negated,
        quote: c.quote?.trim() || null,
        sources: sourcesFor(c.sourceCanonFactIds, canonById),
      }));
    } else {
      // 主張の記録を始める前の発話。保存済みの嘘だけは分かる（位置は分からない）
      hasUntrackedMessages = true;
      own = fabricatedFacts
        .filter((f) => f.introducedMessageId === message.id)
        .map((f) => ({
          id: f.id,
          messageId: message.id,
          verdict: "lie",
          claim: f.claim,
          subject: f.subject,
          relation: f.relation,
          object: f.object,
          negated: f.negated,
          quote: null,
          sources: sourcesFor(f.sourceCanonFactIds, canonById),
        }));
    }

    const { segments, spans } = segmentContent(message.content, own);
    // 番号は会話順・本文中の位置順に振る（位置の分からないものはその発話の最後）
    const position = new Map(spans.map((s) => [s.statementId, s.start]));
    own.sort((a, b) => (position.get(a.id) ?? Infinity) - (position.get(b.id) ?? Infinity));
    statements.push(...own);
    revealMessages.push({ ...base, segments, statementIds: own.map((s) => s.id) });
  }

  return { messages: revealMessages, statements, hasUntrackedMessages };
}

export function toRevealData(built: BuiltReveal, reveal: RevealState | undefined, entities: Entity[] = []): RevealData {
  if (!reveal) {
    const speakerOf = new Map(built.messages.map((m) => [m.id, m.speaker ?? "shiori"] as const));
    const createdAtOf = new Map(built.messages.map((m) => [m.id, m.createdAt]));
    return {
      status: "pending",
      questions: built.statements.map((s) => ({
        id: s.id,
        speaker: speakerOf.get(s.messageId) ?? "shiori",
        text: s.quote ?? s.claim,
        createdAt: createdAtOf.get(s.messageId) ?? "",
      })),
    };
  }
  return { status: "revealed", reveal, ...built, graph: buildRevealGraph(built, entities) };
}
