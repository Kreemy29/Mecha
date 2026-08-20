import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";

// Enqueue a motion-transfer job: drive the approved recreated still with the
// original video. Two interchangeable engines, chosen per batch:
//   runninghub → Wan Animate (RunningHub AI App, needs the Plus 48G instance)
//   kling      → Kling 3.0 Motion Control (Higgsfield `motion_control`)
// Both take the same inputs; the worker uploads them, submits, and polls.
export async function POST(request: NextRequest) {
  const {
    imagePath,
    videoPath,
    characterId,
    seconds,
    prompt,
    engine,
    resolution,
    sceneControl,
  } = await request.json();

  if (!imagePath || !videoPath) {
    return NextResponse.json(
      { error: "imagePath (approved still) and videoPath are required" },
      { status: 400 }
    );
  }

  const useKling = engine === "kling";

  const job = db
    .insert(schema.jobs)
    .values({
      kind: "motion_capture",
      provider: useKling ? "kling" : "runninghub",
      // Kling's motion_control takes no prompt — the field is kept only as a
      // human-readable label on the job row.
      prompt:
        prompt ||
        (useKling
          ? "Kling 3.0 motion control"
          : "Wan Animate character replacement"),
      characterId: characterId || null,
      providerParams: {
        animateImagePath: imagePath,
        animateVideoPath: videoPath,
        ...(seconds != null ? { seconds } : {}),
        ...(useKling
          ? {
              resolution: resolution === "1080p" ? "1080p" : "720p",
              sceneControl: sceneControl === "video" ? "video" : "image",
            }
          : {}),
      },
      status: "queued",
      attempts: 0,
      promptHistory: [],
    })
    .returning()
    .get();

  return NextResponse.json(job, { status: 201 });
}
