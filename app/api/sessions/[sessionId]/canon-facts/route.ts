import { NextResponse } from "next/server";
import { getSession } from "@/lib/server/store";
import { getVisibleCanonFacts } from "@/lib/server/retrieval";

export async function GET(_req: Request, context: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await context.params;
  const session = getSession(sessionId);
  if (!session) {
    return NextResponse.json({ error: "session not found" }, { status: 404 });
  }
  const canonFacts = getVisibleCanonFacts(session);
  return NextResponse.json({ canonFacts });
}
