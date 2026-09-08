import { NextRequest, NextResponse } from "next/server";
import { saveGeneration, unsaveGeneration } from "@/lib/services/higgsfield";

// POST /api/higgsfield/generations/save — body: { generation: Generation }
// Persists one generation (already fetched by the client from listGenerations)
// into the local DB + disk, so it survives independent of Higgsfield.
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const generation = body.generation;
    if (!generation?.id) {
      return NextResponse.json({ error: "generation required" }, { status: 400 });
    }
    const saved = await saveGeneration(generation);
    return NextResponse.json(saved);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// DELETE /api/higgsfield/generations/save?id=<higgsfield_id>
export async function DELETE(request: NextRequest) {
  const id = request.nextUrl.searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }
  unsaveGeneration(id);
  return NextResponse.json({ ok: true });
}
