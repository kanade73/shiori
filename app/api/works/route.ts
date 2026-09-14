import { NextResponse } from "next/server";
import { listWorks } from "@/lib/server/works";

export async function GET() {
  return NextResponse.json({ works: listWorks() });
}
