import { NextRequest, NextResponse } from "next/server";
import { rewritePromptForNsfwMode } from "@/lib/services/grok";

export async function POST(request: NextRequest) {
  const { prompt, characterProfile } = await request.json();

  if (!prompt?.trim()) {
    return NextResponse.json(
      { error: "prompt is required" },
      { status: 400 }
    );
  }

  try {
    const rewrittenPrompt = await rewritePromptForNsfwMode(
      prompt,
      characterProfile || ""
    );
    return NextResponse.json({ prompt: rewrittenPrompt });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
