import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";

// Enqueue a Wan Animate (RunningHub) job: drive the approved recreated still
// with the original video. The worker uploads both, submits the run, and polls.
export async function POST(request: NextRequest) {
  const { imagePath, videoPath, characterId, seconds, prompt } =
    await request.json();

  if (!imagePath || !videoPath) {
    return NextResponse.json(
      { error: "imagePath (approved still) and videoPath are required" },
      { status: 400 }
    );
  }

  const job = db
    .insert(schema.jobs)
    .values({
      kind: "motion_capture",
      provider: "runninghub",
      prompt: prompt || "Wan Animate character replacement",
      characterId: characterId || null,
      providerParams: {
        animateImagePath: imagePath,
        animateVideoPath: videoPath,
        ...(seconds != null ? { seconds } : {}),
      },
      status: "queued",
      attempts: 0,
      promptHistory: [],
    })
    .returning()
    .get();

  return NextResponse.json(job, { status: 201 });
}
