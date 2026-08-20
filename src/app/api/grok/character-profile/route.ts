import { NextRequest, NextResponse } from "next/server";
import { generateCharacterProfile } from "@/lib/services/grok";
import { coercePromptProvider } from "@/lib/services/llm";

export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const { images, provider } = await request.json();

  if (!Array.isArray(images) || images.length < 2) {
    return NextResponse.json(
      { error: "Provide at least 2 reference images" },
      { status: 400 }
    );
  }
  if (images.length > 4) {
    return NextResponse.json(
      { error: "Maximum 4 reference images" },
      { status: 400 }
    );
  }

  try {
    const character = await generateCharacterProfile(
      images,
      coercePromptProvider(provider)
    );
    return NextResponse.json(character);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
