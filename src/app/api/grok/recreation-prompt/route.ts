import { NextRequest, NextResponse } from "next/server";
import { generateRecreationPrompt } from "@/lib/services/grok";

export async function POST(request: NextRequest) {
  const { referenceDescription, characterProfile } = await request.json();

  if (!referenceDescription || !characterProfile) {
    return NextResponse.json(
      { error: "referenceDescription and characterProfile are required" },
      { status: 400 }
    );
  }

  try {
    const prompt = await generateRecreationPrompt(
      referenceDescription,
      characterProfile
    );
    return NextResponse.json({ prompt });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
