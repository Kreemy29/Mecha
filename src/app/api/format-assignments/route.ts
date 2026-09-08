import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { eq } from "drizzle-orm";
import { ensureFormatTables } from "@/lib/services/formats";

export async function POST(request: NextRequest) {
  try {
    ensureFormatTables();
    const { formatId, model, quota } = await request.json();
    const cleanModel = String(model || "").trim();
    if (!formatId || !cleanModel) {
      return NextResponse.json(
        { error: "formatId and model are required" },
        { status: 400 }
      );
    }
    const row = db
      .insert(schema.formatAssignments)
      .values({
        formatId: Number(formatId),
        model: cleanModel,
        quota: Math.max(1, Number(quota) || 1),
      })
      .returning()
      .get();
    return NextResponse.json(row, { status: 201 });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    ensureFormatTables();
    const { id, quota } = await request.json();
    if (!id || !quota) {
      return NextResponse.json({ error: "id and quota are required" }, { status: 400 });
    }
    const row = db
      .update(schema.formatAssignments)
      .set({ quota: Math.max(1, Number(quota)) })
      .where(eq(schema.formatAssignments.id, Number(id)))
      .returning()
      .get();
    return NextResponse.json(row);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  ensureFormatTables();
  const id = parseInt(request.nextUrl.searchParams.get("id") || "");
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });
  db.delete(schema.formatAssignments).where(eq(schema.formatAssignments.id, id)).run();
  return NextResponse.json({ ok: true });
}
