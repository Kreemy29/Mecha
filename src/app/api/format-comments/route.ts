import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { asc, eq } from "drizzle-orm";
import { ensureFormatTables } from "@/lib/services/formats";
import { requireUser } from "@/lib/services/auth";

// The discussion under one format. Oldest first, same shape/purpose as
// ig_request_comments on the Requests page.
export async function GET(request: NextRequest) {
  ensureFormatTables();
  const formatId = parseInt(request.nextUrl.searchParams.get("formatId") || "");
  if (!formatId) {
    return NextResponse.json({ error: "formatId is required" }, { status: 400 });
  }
  return NextResponse.json(
    db
      .select()
      .from(schema.formatComments)
      .where(eq(schema.formatComments.formatId, formatId))
      .orderBy(asc(schema.formatComments.createdAt))
      .all()
  );
}

export async function POST(request: NextRequest) {
  try {
    ensureFormatTables();
    const { user, deny } = await requireUser();
    if (deny) return deny;

    const { formatId, body } = await request.json();
    if (!formatId) {
      return NextResponse.json({ error: "formatId is required" }, { status: 400 });
    }
    if (!body?.trim()) {
      return NextResponse.json({ error: "body is required" }, { status: 400 });
    }
    // A comment on a deleted format would be invisible forever — reject it
    // rather than silently orphaning the row.
    const parent = db
      .select({ id: schema.winningFormats.id })
      .from(schema.winningFormats)
      .where(eq(schema.winningFormats.id, Number(formatId)))
      .get();
    if (!parent) {
      return NextResponse.json({ error: "format not found" }, { status: 404 });
    }

    const row = db
      .insert(schema.formatComments)
      .values({ formatId: Number(formatId), author: user.name, body: body.trim() })
      .returning()
      .get();
    return NextResponse.json(row, { status: 201 });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  ensureFormatTables();
  const id = parseInt(request.nextUrl.searchParams.get("id") || "");
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });
  db.delete(schema.formatComments).where(eq(schema.formatComments.id, id)).run();
  return NextResponse.json({ ok: true });
}
