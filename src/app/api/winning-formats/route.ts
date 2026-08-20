import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { desc, eq } from "drizzle-orm";
import { ensureInstagramTables } from "@/lib/services/instagram";
import { requireUser } from "@/lib/services/auth";
import {
  downloadInstagramReel,
  extractInstagramShortcode,
  saveUploadedVideo,
  extractFramesFromVideo,
} from "@/lib/services/references";

// The reference library for each queue: the reels worth copying. Two ways in —
// upload a file, or paste an Instagram link (which we download so it can be
// watched here even after the original comes down).

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
  ensureInstagramTables();
  const queue = request.nextUrl.searchParams.get("queue");
  const query = db.select().from(schema.winningFormats);
  const rows =
    queue && QUEUES.has(queue)
      ? query
          .where(eq(schema.winningFormats.queue, queue as "meta_ads" | "reels"))
          .orderBy(desc(schema.winningFormats.createdAt))
          .all()
      : query.orderBy(desc(schema.winningFormats.createdAt)).all();
  return NextResponse.json(rows);
}

export async function POST(request: NextRequest) {
  try {
    ensureInstagramTables();
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

    if (contentType.includes("multipart/form-data")) {
      const form = await request.formData();
      queue = String(form.get("queue") || "");
      title = String(form.get("title") || "").trim();
      notes = String(form.get("notes") || "").trim() || null;
      addedBy = user.name;

      const file = form.get("file");
      if (!file || typeof file === "string") {
        return NextResponse.json({ error: "No video file provided" }, { status: 400 });
      }
      videoPath = await saveUploadedVideo(Buffer.from(await file.arrayBuffer()));
      thumbPath = await posterFrame(videoPath);
      if (!title) title = file.name;
    } else {
      const body = await request.json();
      queue = body.queue;
      title = (body.title || "").trim();
      notes = body.notes?.trim() || null;
      addedBy = user.name;
      sourceUrl = (body.url || "").trim() || null;

      if (!sourceUrl) {
        return NextResponse.json(
          { error: "Provide a video file or an Instagram url" },
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
      // Download so it stays watchable here. If it fails (private, deleted, no
      // API key) keep the row anyway — the link alone is still useful.
      try {
        const dl = await downloadInstagramReel(sourceUrl);
        videoPath = dl.videoPath;
        thumbPath = dl.framePath || (await posterFrame(dl.videoPath));
      } catch (err) {
        console.error("[winning-formats] reel download failed:", err);
      }
      if (!title) title = shortcode;
    }

    if (!queue || !QUEUES.has(queue)) {
      return NextResponse.json(
        { error: "A valid queue (meta_ads | reels) is required" },
        { status: 400 }
      );
    }

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
      })
      .returning()
      .get();
    return NextResponse.json(row, { status: 201 });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  ensureInstagramTables();
  const id = parseInt(request.nextUrl.searchParams.get("id") || "");
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });
  db.delete(schema.winningFormats).where(eq(schema.winningFormats.id, id)).run();
  return NextResponse.json({ ok: true });
}
