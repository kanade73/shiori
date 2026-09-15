import { NextResponse } from "next/server";
import { getWork } from "@/lib/server/works";
import { appendMessage, createSession, getFabricatedFacts, listSessions, saveMessageClaims } from "@/lib/server/store";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const workId = searchParams.get("workId") ?? undefined;
  // Hide sessions whose work no longer exists under data/.
  const sessions = listSessions(workId).filter((session) => getWork(session.workId)).map((session) => ({
    ...session,
    fabricatedFactCount: getFabricatedFacts(session.id).filter((f) => f.status === "active").length,
  }));
  return NextResponse.json({ sessions });
}

// issue #14: 話数は聞かない。シオリの問いかけへの答えから、話題の場面を外部の知識源で調べる
const OPENING_MESSAGE = "……今日は何について話したい?";

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const workId = typeof body?.workId === "string" ? body.workId : null;

  if (!workId) {
    return NextResponse.json({ error: "workId is required" }, { status: 400 });
  }

  const work = getWork(workId);
  if (!work) {
    return NextResponse.json({ error: "work not found" }, { status: 404 });
  }

  const session = createSession(workId);
  const opening = appendMessage(session.id, "assistant", OPENING_MESSAGE, "shiori");
  // 定型の問いかけで、設定には触れていない（答え合わせで「記録前の旧データ」扱いにしない）
  saveMessageClaims(session.id, opening.id, []);

  return NextResponse.json({ sessionId: session.id, openingMessage: OPENING_MESSAGE });
}
