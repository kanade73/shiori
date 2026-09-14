import { NextResponse } from "next/server";
import { getFabricatedFacts, getFabricatedRelations, getSession } from "@/lib/server/store";

export async function GET(_req: Request, context: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await context.params;
  if (!getSession(sessionId)) {
    return NextResponse.json({ error: "session not found" }, { status: 404 });
  }

  const nodes = getFabricatedFacts(sessionId).map((fact) => ({ id: fact.id, label: fact.claim }));
  const edges = getFabricatedRelations(sessionId).map((rel) => ({
    from: rel.fromFactId,
    to: rel.toFactId,
    relation: rel.relation,
  }));

  return NextResponse.json({ nodes, edges });
}
