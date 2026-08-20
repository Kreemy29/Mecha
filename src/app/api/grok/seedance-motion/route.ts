import { NextRequest, NextResponse } from "next/server";
import { generateSeedanceMotionPrompt } from "@/lib/services/grok";
import { coercePromptProvider } from "@/lib/services/llm";

// Refine a short action ("tilting head, slightly smiling") into a full Seedance
// image-to-video motion prompt. Used only by the image-to-video engine — the
// video-driven path gets its motion from the reference clip instead.
export async function POST(request: NextRequest) {
  try {
    const { action, provider } = await request.json();
    if (!action?.trim()) {
      return NextResponse.json({ error: "action is required" }, { status: 400 });
    }
    const prompt = await generateSeedanceMotionPrompt(
      action,
      coercePromptProvider(provider)
    );
    return NextResponse.json({ prompt });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
