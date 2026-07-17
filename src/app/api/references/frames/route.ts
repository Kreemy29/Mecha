import { NextRequest, NextResponse } from "next/server";
import { extractFramesFromVideo } from "@/lib/services/references";

// Extract candidate frames from the start of a video so the operator can pick
// the cleanest pose to recreate.
export async function POST(request: NextRequest) {
  const { videoPath, count, seconds } = await request.json();

  if (!videoPath) {
    return NextResponse.json({ error: "videoPath is required" }, { status: 400 });
  }

  try {
    const frames = await extractFramesFromVideo(
      videoPath,
      count || 10,
      seconds || 2
    );
    return NextResponse.json({ frames });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
