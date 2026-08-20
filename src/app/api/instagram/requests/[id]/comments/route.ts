import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { asc, eq } from "drizzle-orm";
import { ensureInstagramTables } from "@/lib/services/instagram";
import { requireUser } from "@/lib/services/auth";

// The discussion on one request: replies between whoever assigned the clip and
// whoever is producing it. Oldest first, so it reads like a thread.
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  ensureInstagramTables();
  const requestId = parseInt((await params).id);
  if (!requestId) {
    return NextResponse.json({ error: "bad request id" }, { status: 400 });
  }
  return NextResponse.json(
    db
      .select()
      .from(schema.igRequestComments)
      .where(eq(schema.igRequestComments.requestId, requestId))
      .orderBy(asc(schema.igRequestComments.createdAt))
      .all()
  );
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    ensureInstagramTables();
    const { user, deny } = await requireUser();
    if (deny) return deny;

    const requestId = parseInt((await params).id);
    const { body } = await request.json();

    if (!requestId) {
      return NextResponse.json({ error: "bad request id" }, { status: 400 });
    }
    if (!body?.trim()) {
      return NextResponse.json({ error: "body is required" }, { status: 400 });
    }
    // A reply on a deleted request would be invisible forever — reject it
    // rather than silently orphaning the row.
    const parent = db
      .select({ id: schema.igRequests.id })
      .from(schema.igRequests)
      .where(eq(schema.igRequests.id, requestId))
      .get();
    if (!parent) {
      return NextResponse.json({ error: "request not found" }, { status: 404 });
    }

    const row = db
      .insert(schema.igRequestComments)
      .values({ requestId, author: user.name, body: body.trim() })
      .returning()
      .get();
    return NextResponse.json(row, { status: 201 });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  ensureInstagramTables();
  const requestId = parseInt((await params).id);
  const commentId = parseInt(
    request.nextUrl.searchParams.get("commentId") || ""
  );
  if (!requestId || !commentId) {
    return NextResponse.json(
      { error: "request id and commentId are required" },
      { status: 400 }
    );
  }
  db.delete(schema.igRequestComments)
    .where(eq(schema.igRequestComments.id, commentId))
    .run();
  return NextResponse.json({ ok: true });
}
