import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";

// Enqueue a Seedance (Higgsfield generate_video) job: drive the approved still
// (@Image1) with the reference video (@Video1) using the Grok replacement prompt.
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
  } = await request.json();

  if (!imagePath || !videoPath || !prompt) {
    return NextResponse.json(
      { error: "imagePath, videoPath and prompt are required" },
      { status: 400 }
    );
  }

  // "kie" → KIE AI provider; anything else → Higgsfield's generate_video.
  const useKie = provider === "kie";

  const job = db
    .insert(schema.jobs)
    .values({
      kind: "seedance",
      provider: useKie ? "kie" : "seedance",
      providerModel: useKie ? (fast ? "fast" : "standard") : null,
      prompt,
      characterId: characterId || null,
      providerParams: {
        seedanceImagePath: imagePath,
        seedanceVideoPath: videoPath,
        aspectRatio: aspectRatio || "9:16",
        ...(duration != null ? { duration } : {}),
        ...(outfit ? { outfit } : {}),
      },
      status: "queued",
      attempts: 0,
      promptHistory: [],
    })
    .returning()
    .get();

  return NextResponse.json(job, { status: 201 });
}
