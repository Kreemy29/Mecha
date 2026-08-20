import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { db, schema } from "@/lib/db";
import { eq } from "drizzle-orm";
import { ensureInstagramTables } from "@/lib/services/instagram";
import {
  downloadInstagramReel,
  getVideoDurationSeconds,
} from "@/lib/services/references";

// Download the actual video for a saved media row (via mediaByShortcode).
// Idempotent: if the video is already on disk, reuse it. This is the step
// before handing off to Seedance / Motion Capture.
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    ensureInstagramTables();
    const { id } = await params;
    const row = db
      .select()
      .from(schema.igMedia)
      .where(eq(schema.igMedia.id, parseInt(id)))
      .get();
    if (!row) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    if (row.videoPath && fs.existsSync(path.resolve(row.videoPath))) {
      return NextResponse.json(row);
    }

    const { videoPath } = await downloadInstagramReel(
      `https://www.instagram.com/reel/${row.shortcode}/`
    );
    const durationSeconds = getVideoDurationSeconds(videoPath);

    const updated = db
      .update(schema.igMedia)
      .set({ videoPath, durationSeconds })
      .where(eq(schema.igMedia.id, row.id))
      .returning()
      .get();
    return NextResponse.json(updated);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
