import { NextRequest, NextResponse } from "next/server";
import { generateSwapPrompt } from "@/lib/services/grok";

export async function POST(request: NextRequest) {
  const {
    sceneRefUrl,
    faceRefUrl,
    bodyRefUrl,
    settingDescription,
    characterName,
    outfitOverride,
    backgroundRefUrl,
    backgroundDescription,
  } = await request.json();

  if (!sceneRefUrl || !faceRefUrl) {
    return NextResponse.json(
      { error: "sceneRefUrl and faceRefUrl are required" },
      { status: 400 }
    );
  }

  try {
    const prompt = await generateSwapPrompt({
      sceneRefUrl,
      faceRefUrl,
      bodyRefUrl,
      settingDescription,
      characterName,
      outfitOverride,
      backgroundRefUrl,
      backgroundDescription,
    });
    return NextResponse.json({ prompt });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
