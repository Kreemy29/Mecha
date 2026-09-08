import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { desc, eq, inArray } from "drizzle-orm";
import { ensureFormatTables } from "@/lib/services/formats";
import { requireUser } from "@/lib/services/auth";
import {
  downloadInstagramReel,
  extractInstagramShortcode,
  saveUploadedVideo,
  extractFramesFromVideo,
} from "@/lib/services/references";

// The reference library: the clips worth copying, and (for ones created from
// the weekly Formats board) which week/model quotas they're assigned to.
// Three ways in — upload a file, paste an Instagram link (downloaded so it
// stays watchable here), or point at an Instagram clip already saved via the
// Instagram page (no re-download needed).

const QUEUES = new Set(["meta_ads", "reels"]);

// A poster frame so the shelf isn't a wall of black rectangles. Non-fatal:
// a format without a thumbnail still plays.
async function posterFrame(videoPath: string): Promise<string | null> {
  try {
    const frames = await extractFramesFromVideo(videoPath, 1, 1, 0);
    return frames[0] ?? null;
  } catch {
    return null;
  }
}

export async function GET(request: NextRequest) {
  ensureFormatTables();
  const sp = request.nextUrl.searchParams;
  const queue = sp.get("queue");
  const weekIdParam = sp.get("weekId");

  let query = db.select().from(schema.winningFormats).$dynamic();
  if (queue && QUEUES.has(queue)) {
    query = query.where(eq(schema.winningFormats.queue, queue as "meta_ads" | "reels"));
  }
  if (weekIdParam) {
    query = query.where(eq(schema.winningFormats.weekId, parseInt(weekIdParam)));
  }
  const rows = query.orderBy(desc(schema.winningFormats.createdAt)).all();

  const ids = rows.map((r) => r.id);
  const assignments = ids.length
    ? db
        .select()
        .from(schema.formatAssignments)
        .where(inArray(schema.formatAssignments.formatId, ids))
        .all()
    : [];
  const byFormat = new Map<number, typeof assignments>();
  for (const a of assignments) {
    const list = byFormat.get(a.formatId) || [];
    list.push(a);
    byFormat.set(a.formatId, list);
  }

  return NextResponse.json(
    rows.map((r) => ({ ...r, assignments: byFormat.get(r.id) || [] }))
  );
}

export async function POST(request: NextRequest) {
  try {
    ensureFormatTables();
    const { user, deny } = await requireUser();
    if (deny) return deny;
    const contentType = request.headers.get("content-type") || "";

    let queue: string | null = null;
    let title = "";
    let notes: string | null = null;
    let addedBy: string | null = null;
    let videoPath: string | null = null;
    let thumbPath: string | null = null;
    let sourceUrl: string | null = null;
    let shortcode: string | null = null;
    let weekId: number | null = null;

    if (contentType.includes("multipart/form-data")) {
      const form = await request.formData();
      queue = String(form.get("queue") || "");
      title = String(form.get("title") || "").trim();
      notes = String(form.get("notes") || "").trim() || null;
      addedBy = user.name;
      const weekIdRaw = form.get("weekId");
      weekId = weekIdRaw ? parseInt(String(weekIdRaw)) || null : null;

      const file = form.get("file");
      if (!file || typeof file === "string") {
        return NextResponse.json({ error: "No video file provided" }, { status: 400 });
      }
      videoPath = await saveUploadedVideo(Buffer.from(await file.arrayBuffer()));
      thumbPath = await posterFrame(videoPath);
      if (!title) title = file.name;
    } else {
      const body = await request.json();
      queue = body.queue || null;
      title = (body.title || "").trim();
      notes = body.notes?.trim() || null;
      addedBy = user.name;
      weekId = body.weekId ? Number(body.weekId) || null : null;

      if (body.mediaId) {
        // Import a clip already saved via the Instagram page — no download,
        // just reuse what's already on disk.
        const media = db
          .select()
          .from(schema.igMedia)
          .where(eq(schema.igMedia.id, Number(body.mediaId)))
          .get();
        if (!media) {
          return NextResponse.json({ error: "Saved media not found" }, { status: 404 });
        }
        if (!media.videoPath) {
          return NextResponse.json(
            { error: "That saved clip hasn't been downloaded yet — open it on the Instagram page first" },
            { status: 400 }
          );
        }
        videoPath = media.videoPath;
        thumbPath = media.thumbPath;
        shortcode = media.shortcode;
        sourceUrl = `https://www.instagram.com/reel/${media.shortcode}/`;
        if (!title) title = media.caption?.slice(0, 60) || media.shortcode;
      } else {
        sourceUrl = (body.url || "").trim() || null;
        if (!sourceUrl) {
          return NextResponse.json(
            { error: "Provide a video file, an Instagram url, or a saved clip's mediaId" },
            { status: 400 }
          );
        }
        shortcode = extractInstagramShortcode(sourceUrl);
        if (!shortcode) {
          return NextResponse.json(
            { error: `Not an Instagram reel/post link: ${sourceUrl}` },
            { status: 400 }
          );
        }
        // Download so it stays watchable here. If it fails (private, deleted,
        // no API key) keep the row anyway — the link alone is still useful.
        try {
          const dl = await downloadInstagramReel(sourceUrl);
          videoPath = dl.videoPath;
          thumbPath = dl.framePath || (await posterFrame(dl.videoPath));
        } catch (err) {
          console.error("[winning-formats] reel download failed:", err);
        }
        if (!title) title = shortcode;
      }
    }

    // The weekly Formats board doesn't distinguish ad vs. organic — default
    // to "reels" rather than force that choice on every format.
    if (!queue || !QUEUES.has(queue)) queue = "reels";

    const row = db
      .insert(schema.winningFormats)
      .values({
        queue: queue as "meta_ads" | "reels",
        title: title || "Untitled",
        videoPath,
        thumbPath,
        sourceUrl,
        shortcode,
        notes,
        addedBy,
        weekId,
      })
      .returning()
      .get();
    return NextResponse.json({ ...row, assignments: [] }, { status: 201 });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// Attach/detach the Methods generation that shows the VA how this format is
// done, move it to another week, or touch up title/notes.
export async function PATCH(request: NextRequest) {
  try {
    ensureFormatTables();
    const { id, methodGenerationId, weekId, title, notes } = await request.json();
    if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

    const updates: Partial<typeof schema.winningFormats.$inferInsert> = {};
    if (methodGenerationId !== undefined) updates.methodGenerationId = methodGenerationId || null;
    if (weekId !== undefined) updates.weekId = weekId || null;
    if (title !== undefined) updates.title = title;
    if (notes !== undefined) updates.notes = notes;

    const row = db
      .update(schema.winningFormats)
      .set(updates)
      .where(eq(schema.winningFormats.id, Number(id)))
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
  db.delete(schema.formatAssignments).where(eq(schema.formatAssignments.formatId, id)).run();
  db.delete(schema.winningFormats).where(eq(schema.winningFormats.id, id)).run();
  return NextResponse.json({ ok: true });
}
