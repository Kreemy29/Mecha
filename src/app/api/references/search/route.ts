import { NextRequest, NextResponse } from "next/server";
import { searchPinterest } from "@/lib/services/references";

export async function POST(request: NextRequest) {
  const { query, pages } = await request.json();

  if (!query) {
    return NextResponse.json({ error: "query is required" }, { status: 400 });
  }

  try {
    const results = await searchPinterest(query, pages || 3);
    return NextResponse.json({ results });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
