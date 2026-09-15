import { NextResponse } from "next/server";
import { getFabricatedFacts, getMessageClaims, getMessages, getSession, revealSession } from "@/lib/server/store";
import { getEntities } from "@/lib/server/works";
import { getVisibleCanonFacts } from "@/lib/server/retrieval";
import { buildReveal, toRevealData } from "@/lib/server/reveal/build";
import type { ChatSession } from "@/lib/server/types";
import type { Verdict } from "@/lib/server/reveal/types";

function build(session: ChatSession) {
  return buildReveal({
    messages: getMessages(session.id),
    messageClaims: getMessageClaims(session.id),
    fabricatedFacts: getFabricatedFacts(session.id),
    canonFacts: getVisibleCanonFacts(session),
  });
}

/** 答え合わせ前は問題（真偽なし）だけ、答え合わせ後は真偽つきの会話を返す。 */
export async function GET(_req: Request, context: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await context.params;
  const session = getSession(sessionId);
  if (!session) {
    return NextResponse.json({ error: "session not found" }, { status: 404 });
  }
  return NextResponse.json(toRevealData(build(session), session.reveal, getEntities(session.workId)));
}

/**
 * 予想を受け取って答え合わせ済みにする。これで会話は終わり（以後メッセージは送れない）。
 * 既に答え合わせ済みなら最初の予想のまま結果を返す。
 */
export async function POST(req: Request, context: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await context.params;
  const session = getSession(sessionId);
  if (!session) {
    return NextResponse.json({ error: "session not found" }, { status: 404 });
  }

  const body = await req.json().catch(() => null);
  const raw: unknown = body?.guesses ?? {};
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return NextResponse.json({ error: "guesses must be an object" }, { status: 400 });
  }

  const built = build(session);
  const ids = new Set(built.statements.map((s) => s.id));
  const guesses: Record<string, Verdict> = {};
  for (const [id, value] of Object.entries(raw)) {
    if (ids.has(id) && (value === "true" || value === "lie")) guesses[id] = value;
  }

  const revealed = revealSession(sessionId, guesses);
  if (!revealed) {
    return NextResponse.json({ error: "session not found" }, { status: 404 });
  }
  return NextResponse.json(toRevealData(built, revealed.reveal, getEntities(session.workId)));
}
