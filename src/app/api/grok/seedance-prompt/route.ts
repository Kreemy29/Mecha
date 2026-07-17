import { NextResponse } from "next/server";
import { generateSeedancePrompt } from "@/lib/services/grok";

// Returns the Seedance video prompt. This is a static, operator-authored
// template — no Grok call and no frame sampling: Higgsfield reads the linked
// @[Image 1] / @[Video 1] elements directly, so it doesn't need a written-out
// movement sequence. Kept as a route so the UI flow (and any future
// per-video customization) stays in one place.
export async function POST() {
  try {
    const prompt = await generateSeedancePrompt();
    return NextResponse.json({ prompt });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
