import { NextRequest, NextResponse } from "next/server";
import {
  trimVideo,
  getVideoDurationSeconds,
} from "@/lib/services/references";

// Cut one segment out of a video, so a shot can be driven by just its own scene
// rather than the whole clip. POST { videoPath, start, end? }
export async function POST(request: NextRequest) {
  const { videoPath, start, end } = await request.json();

  if (!videoPath) {
    return NextResponse.json({ error: "videoPath is required" }, { status: 400 });
  }

  try {
    const segmentPath = await trimVideo(
      videoPath,
      Number(start) || 0,
      end != null ? Number(end) : undefined
    );
    return NextResponse.json({
      videoPath: segmentPath,
      durationSeconds: getVideoDurationSeconds(segmentPath),
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
