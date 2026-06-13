import { NextRequest, NextResponse } from "next/server";
import { rewritePromptWithNotes } from "@/lib/services/grok";

export async function POST(request: NextRequest) {
  const { previousPrompt, rejectionNotes, characterProfile } =
    await request.json();

  if (!previousPrompt || !rejectionNotes || !characterProfile) {
    return NextResponse.json(
      {
        error:
          "previousPrompt, rejectionNotes, and characterProfile are required",
      },
      { status: 400 }
    );
  }

  try {
    const prompt = await rewritePromptWithNotes(
      previousPrompt,
      rejectionNotes,
      characterProfile
    );
    return NextResponse.json({ prompt });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
