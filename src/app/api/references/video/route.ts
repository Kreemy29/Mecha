import { NextRequest, NextResponse } from "next/server";
import {
  downloadInstagramReel,
  saveUploadedVideo,
  getVideoDurationSeconds,
} from "@/lib/services/references";

// Intake a driving video for the animate flow — either an uploaded file
// (multipart) or an Instagram reel link (JSON). Returns the local video path.
export async function POST(request: NextRequest) {
  try {
    const contentType = request.headers.get("content-type") || "";

    // ── Uploaded file (multipart/form-data) ──
    if (contentType.includes("multipart/form-data")) {
      const form = await request.formData();
      const file = form.get("file");
      if (!file || typeof file === "string") {
        return NextResponse.json(
          { error: "No video file provided" },
          { status: 400 }
        );
      }
      const buffer = Buffer.from(await file.arrayBuffer());
      const videoPath = await saveUploadedVideo(buffer);
      return NextResponse.json({
        videoPath,
        sourceKind: "manual",
        durationSeconds: getVideoDurationSeconds(videoPath),
      });
    }

    // ── Instagram reel link (JSON) ──
    const { reelUrl } = await request.json();
    if (!reelUrl) {
      return NextResponse.json(
        { error: "Provide a video file or reelUrl" },
        { status: 400 }
      );
    }
    const { videoPath } = await downloadInstagramReel(reelUrl);
    return NextResponse.json({
      videoPath,
      sourceKind: "instagram",
      durationSeconds: getVideoDurationSeconds(videoPath),
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
