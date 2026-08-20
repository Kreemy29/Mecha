import { NextRequest, NextResponse } from "next/server";
import { extractFramesFromVideo } from "@/lib/services/references";

// Extract candidate frames from a window of a video so the operator can pick
// the cleanest pose to recreate. `start` seeks into the clip — the best pose is
// often well past the opening frames.
export async function POST(request: NextRequest) {
  const { videoPath, count, seconds, start } = await request.json();

  if (!videoPath) {
    return NextResponse.json({ error: "videoPath is required" }, { status: 400 });
  }

  try {
    const frames = await extractFramesFromVideo(
      videoPath,
      count || 10,
      seconds || 2,
      Number(start) || 0
    );
    return NextResponse.json({ frames });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
