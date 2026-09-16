import { NextResponse } from "next/server";
import { deleteSession, getSession, getMessages, getFabricatedFacts } from "@/lib/server/store";
import { getWork } from "@/lib/server/works";

export async function GET(_req: Request, context: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await context.params;
  const session = await getSession(sessionId);
  if (!session) {
    return NextResponse.json({ error: "session not found" }, { status: 404 });
  }
  const work = getWork(session.workId);
  if (!work) {
    // The work's data directory was removed after this session was created.
    return NextResponse.json({ error: "work not found for this session" }, { status: 404 });
  }
  const messages = await getMessages(sessionId);
  const fabricatedFactCount = (await getFabricatedFacts(sessionId)).filter((f) => f.status === "active").length;

  return NextResponse.json({ session, work, messages, fabricatedFactCount });
}

/** サイドバーのゴミ箱から、過去のセッションを履歴ごと消す */
export async function DELETE(_req: Request, context: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await context.params;
  if (!(await deleteSession(sessionId))) {
    return NextResponse.json({ error: "session not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
