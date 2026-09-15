import { NextResponse } from "next/server";
import { getSession, getMessages, getFabricatedFacts } from "@/lib/server/store";
import { getWork } from "@/lib/server/works";

export async function GET(_req: Request, context: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await context.params;
  const session = getSession(sessionId);
  if (!session) {
    return NextResponse.json({ error: "session not found" }, { status: 404 });
  }
  const work = getWork(session.workId);
  if (!work) {
    // The work's data directory was removed after this session was created.
    return NextResponse.json({ error: "work not found for this session" }, { status: 404 });
  }
  const messages = getMessages(sessionId);
  const fabricatedFactCount = getFabricatedFacts(sessionId).filter((f) => f.status === "active").length;

  return NextResponse.json({ session, work, messages, fabricatedFactCount });
}
