import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";

// Enqueue a video job that drives the approved still with a reference clip.
//   engine "seedance" → Higgsfield generate_video (or KIE), prompt-driven
//   engine "kling"    → Higgsfield motion_control (Kling 3), takes NO prompt
// Both consume the same inputs, so the engine is a per-batch swap.
export async function POST(request: NextRequest) {
  const {
    imagePath,
    videoPath,
    prompt,
    duration,
    aspectRatio,
    characterId,
    outfit,
    provider,
    fast,
    engine,
    resolution,
  } = await request.json();

  const useKling = engine === "kling";

  // Kling derives everything from the two media inputs, so it needs no prompt.
  // videoPath may be omitted on the Seedance engine = image-to-video (the
  // prompt alone carries the motion); Kling always needs a driving clip.
  if (!imagePath || (!prompt && !useKling) || (useKling && !videoPath)) {
    return NextResponse.json(
      { error: "imagePath and prompt (or a driving video for Kling) are required" },
      { status: 400 }
    );
  }

  // "kie" → KIE AI provider; anything else → Higgsfield's generate_video.
  const useKie = !useKling && provider === "kie";

  const job = db
    .insert(schema.jobs)
    .values({
      kind: "seedance",
      provider: useKling ? "kling" : useKie ? "kie" : "seedance",
      providerModel: useKie ? (fast ? "fast" : "standard") : null,
      prompt: prompt || "Kling 3 motion control",
      characterId: characterId || null,
      providerParams: {
        seedanceImagePath: imagePath,
        ...(videoPath ? { seedanceVideoPath: videoPath } : {}),
        aspectRatio: aspectRatio || "9:16",
        ...(duration != null ? { duration } : {}),
        ...(outfit ? { outfit } : {}),
        ...(useKling
          ? {
              resolution: resolution === "1080p" ? "1080p" : "720p",
              sceneControl: "image",
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
