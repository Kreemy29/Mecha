import { NextRequest, NextResponse } from "next/server";
import { listGenerations } from "@/lib/services/higgsfield";

// GET /api/higgsfield/generations?cursor=...
// Browses the whole Higgsfield account's generation history (prompt, settings,
// output) — not just jobs submitted through Mecha.
export async function GET(request: NextRequest) {
  try {
    const cursor = request.nextUrl.searchParams.get("cursor") || undefined;
    const page = await listGenerations(cursor);
    return NextResponse.json(page);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
