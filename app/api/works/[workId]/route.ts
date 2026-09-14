import { NextResponse } from "next/server";
import { getWork } from "@/lib/server/works";

export async function GET(_req: Request, context: { params: Promise<{ workId: string }> }) {
  const { workId } = await context.params;
  const work = getWork(workId);
  if (!work) {
    return NextResponse.json({ error: "work not found" }, { status: 404 });
  }
  return NextResponse.json({ work });
}
