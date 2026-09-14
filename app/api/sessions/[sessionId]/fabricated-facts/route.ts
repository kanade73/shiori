import { NextResponse } from "next/server";
import { getFabricatedFacts, getMessages, getSession } from "@/lib/server/store";
import { getAllCanonFacts } from "@/lib/server/works";

export async function GET(_req: Request, context: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await context.params;
  const session = getSession(sessionId);
  if (!session) {
    return NextResponse.json({ error: "session not found" }, { status: 404 });
  }

  const facts = getFabricatedFacts(sessionId);
  const canonFacts = getAllCanonFacts(session.workId);
  const messages = getMessages(sessionId);

  const enriched = facts.map((fact) => ({
    ...fact,
    sourceCanonFacts: canonFacts.filter((c) => fact.sourceCanonFactIds.includes(c.id)),
    introducedMessage: messages.find((m) => m.id === fact.introducedMessageId) ?? null,
  }));

  return NextResponse.json({ fabricatedFacts: enriched });
}
