import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { and, asc, desc, eq } from "drizzle-orm";
import { ensureInstagramTables } from "@/lib/services/instagram";
import { ensurePresetTables } from "@/lib/services/presets-store";
import { requireUser } from "@/lib/services/auth";

// Work queues: a saved clip handed to someone to produce, with a comment and
// optionally the model/format it should be made with.
//
// GET returns each request already joined to its media row, because the queue
// page is entirely made of clip cards — making the client fetch media
// separately would be one request per row.

const QUEUES = new Set(["meta_ads", "reels"]);

export async function GET(request: NextRequest) {
  ensureInstagramTables();
  ensurePresetTables();
  const sp = request.nextUrl.searchParams;
  const queue = sp.get("queue");
  const status = sp.get("status");

  const filters = [
    queue && QUEUES.has(queue)
      ? eq(schema.igRequests.queue, queue as "meta_ads" | "reels")
      : undefined,
    status === "open" || status === "done"
      ? eq(schema.igRequests.status, status)
      : undefined,
  ].filter(Boolean);

  const rows = db
    .select({
      id: schema.igRequests.id,
      mediaId: schema.igRequests.mediaId,
      queue: schema.igRequests.queue,
      comment: schema.igRequests.comment,
      model: schema.igRequests.model,
      formatId: schema.igRequests.formatId,
      assignedBy: schema.igRequests.assignedBy,
      status: schema.igRequests.status,
      createdAt: schema.igRequests.createdAt,
      shortcode: schema.igMedia.shortcode,
      caption: schema.igMedia.caption,
      thumbPath: schema.igMedia.thumbPath,
      videoPath: schema.igMedia.videoPath,
      durationSeconds: schema.igMedia.durationSeconds,
      accountId: schema.igMedia.accountId,
    })
    .from(schema.igRequests)
    .innerJoin(schema.igMedia, eq(schema.igRequests.mediaId, schema.igMedia.id))
    .where(filters.length ? and(...filters) : undefined)
    .orderBy(desc(schema.igRequests.createdAt))
    .all();

  // Resolve format names in one pass so the card can show "Format: X" without
  // the client loading the whole preset library.
  const formats = db
    .select({ id: schema.promptPresets.id, name: schema.promptPresets.name })
    .from(schema.promptPresets)
    .all();
  const nameById = new Map(formats.map((f) => [f.id, f.name]));

  // Every reply, in one query, grouped by request. The volume here is a
  // handful of rows per queue, so shipping the threads with the list beats a
  // fetch per card when the operator expands one.
  const comments = db
    .select()
    .from(schema.igRequestComments)
    .orderBy(asc(schema.igRequestComments.createdAt))
    .all();
  const threads = new Map<number, typeof comments>();
  for (const c of comments) {
    const list = threads.get(c.requestId);
    if (list) list.push(c);
    else threads.set(c.requestId, [c]);
  }

  return NextResponse.json(
    rows.map((r) => ({
      ...r,
      formatName: r.formatId ? (nameById.get(r.formatId) ?? null) : null,
      comments: threads.get(r.id) ?? [],
      // Built here so the client never has to know Instagram's URL shape.
      instagramUrl: `https://www.instagram.com/reel/${r.shortcode}/`,
    }))
  );
}

export async function POST(request: NextRequest) {
  try {
    ensureInstagramTables();
    // Identity comes from the session, never the request body — a client can
    // claim to be anyone.
    const { user, deny } = await requireUser();
    if (deny) return deny;

    const { mediaId, queue, comment, model, formatId } = await request.json();

    if (!mediaId || !QUEUES.has(queue)) {
      return NextResponse.json(
        { error: "mediaId and a valid queue (meta_ads | reels) are required" },
        { status: 400 }
      );
    }

    // The clip must already be saved; a request pointing at nothing would
    // render as an empty card forever.
    const media = db
      .select()
      .from(schema.igMedia)
      .where(eq(schema.igMedia.id, mediaId))
      .get();
    if (!media) {
      return NextResponse.json(
        { error: `No saved clip with id ${mediaId}` },
        { status: 404 }
      );
    }

    const row = db
      .insert(schema.igRequests)
      .values({
        mediaId,
        queue,
        comment: comment?.trim() || null,
        model: model?.trim() || null,
        formatId: formatId ?? null,
        assignedBy: user.name,
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
  ensureInstagramTables();
  const { id, status, comment } = await request.json();
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });
  const row = db
    .update(schema.igRequests)
    .set({
      ...(status === "open" || status === "done" ? { status } : {}),
      ...(comment !== undefined ? { comment: String(comment).trim() || null } : {}),
    })
    .where(eq(schema.igRequests.id, id))
    .returning()
    .get();
  return NextResponse.json(row);
}

export async function DELETE(request: NextRequest) {
  ensureInstagramTables();
  const id = parseInt(request.nextUrl.searchParams.get("id") || "");
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });
  // Replies first — otherwise they linger pointing at a request that no longer
  // exists, and the thread query would carry them forever.
  db.delete(schema.igRequestComments)
    .where(eq(schema.igRequestComments.requestId, id))
    .run();
  db.delete(schema.igRequests).where(eq(schema.igRequests.id, id)).run();
  return NextResponse.json({ ok: true });
}
