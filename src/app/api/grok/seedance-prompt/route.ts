import { NextRequest, NextResponse } from "next/server";
import { generateSeedancePrompt } from "@/lib/services/grok";

// Returns the Seedance video prompt. This is a static, operator-authored
// template — no Grok call and no frame sampling: Higgsfield reads the linked
// @[Image 1] / @[Video 1] elements directly, so it doesn't need a written-out
// movement sequence. Kept as a route so the UI flow (and any future
// per-video customization) stays in one place.
export async function POST(request: NextRequest) {
  try {
    // { natural: true } swaps in the subtle-motion wording for selfie shots.
    let natural = false;
    try {
      natural = !!(await request.json())?.natural;
    } catch {
      // empty body — keep the default template
    }
    const prompt = await generateSeedancePrompt(natural);
    return NextResponse.json({ prompt });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
