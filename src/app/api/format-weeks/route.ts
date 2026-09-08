import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { desc, eq } from "drizzle-orm";
import { ensureFormatTables } from "@/lib/services/formats";

export async function GET() {
  ensureFormatTables();
  const rows = db
    .select()
    .from(schema.formatWeeks)
    .orderBy(desc(schema.formatWeeks.id))
    .all();
  return NextResponse.json(rows);
}

export async function POST(request: NextRequest) {
  try {
    ensureFormatTables();
    const { label } = await request.json();
    const clean = String(label || "").trim();
    if (!clean) {
      return NextResponse.json({ error: "label is required" }, { status: 400 });
    }
    const row = db.insert(schema.formatWeeks).values({ label: clean }).returning().get();
    return NextResponse.json(row, { status: 201 });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// Deletes only the week itself — its formats are detached (week_id -> NULL),
// not deleted, since the videos/assignments are still worth keeping around.
export async function DELETE(request: NextRequest) {
  ensureFormatTables();
  const id = parseInt(request.nextUrl.searchParams.get("id") || "");
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  db
    .update(schema.winningFormats)
    .set({ weekId: null })
    .where(eq(schema.winningFormats.weekId, id))
    .run();
  db.delete(schema.formatWeeks).where(eq(schema.formatWeeks.id, id)).run();
  return NextResponse.json({ ok: true });
}
