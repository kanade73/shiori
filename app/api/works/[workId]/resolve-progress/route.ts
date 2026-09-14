import { NextResponse } from "next/server";
import { getWork } from "@/lib/server/works";
import { resolveViewingProgress } from "@/lib/server/progress-resolver";

export async function POST(req: Request, context: { params: Promise<{ workId: string }> }) {
  const { workId } = await context.params;
  if (!getWork(workId)) {
    return NextResponse.json({ error: "work not found" }, { status: 404 });
  }

  const body = await req.json().catch(() => null);
  const description = typeof body?.description === "string" ? body.description.trim() : "";
  if (!description) {
    return NextResponse.json({ error: "description is required" }, { status: 400 });
  }
  if (description.length > 200) {
    return NextResponse.json({ error: "description must be 200 characters or fewer" }, { status: 400 });
  }

  const resolution = resolveViewingProgress(workId, description);
  return NextResponse.json(resolution);
}
