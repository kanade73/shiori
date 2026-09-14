import { NextResponse } from "next/server";
import { getWork } from "@/lib/server/works";
import { appendMessage, createSession, getFabricatedFacts, listSessions } from "@/lib/server/store";

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

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const workId = typeof body?.workId === "string" ? body.workId : null;
  const currentEpisode = Number(body?.currentEpisode);
  const progressDescription = typeof body?.progressDescription === "string" ? body.progressDescription.trim() : undefined;

  if (!workId || !Number.isFinite(currentEpisode) || currentEpisode < 1) {
    return NextResponse.json({ error: "workId and a positive currentEpisode are required" }, { status: 400 });
  }
  if (progressDescription && progressDescription.length > 200) {
    return NextResponse.json({ error: "progressDescription must be 200 characters or fewer" }, { status: 400 });
  }

  const work = getWork(workId);
  if (!work) {
    return NextResponse.json({ error: "work not found" }, { status: 404 });
  }

  const session = createSession(
    workId,
    Math.min(currentEpisode, work.episodeCount ?? currentEpisode),
    progressDescription || undefined,
  );
  const openingMessage = progressDescription
    ? `……${progressDescription}、か。何が一番印象に残った?`
    : `……第${session.currentEpisode}話まで見たんだ。何が一番印象に残った?`;
  appendMessage(session.id, "assistant", openingMessage);

  return NextResponse.json({ sessionId: session.id, openingMessage });
}
