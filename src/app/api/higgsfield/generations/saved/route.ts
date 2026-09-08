import { NextResponse } from "next/server";
import { listSavedGenerations } from "@/lib/services/higgsfield";

// GET /api/higgsfield/generations/saved — the locally-kept subset, not the
// live Higgsfield browse.
export async function GET() {
  try {
    return NextResponse.json({ items: listSavedGenerations() });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
