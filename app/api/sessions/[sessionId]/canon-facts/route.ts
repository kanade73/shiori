import { NextResponse } from "next/server";
import { getSession } from "@/lib/server/store";
import { getCanonFactsUpTo } from "@/lib/server/works";

export async function GET(_req: Request, context: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await context.params;
  const session = getSession(sessionId);
  if (!session) {
    return NextResponse.json({ error: "session not found" }, { status: 404 });
  }
  const canonFacts = getCanonFactsUpTo(session.workId, session.currentEpisode);
  return NextResponse.json({ canonFacts });
}
