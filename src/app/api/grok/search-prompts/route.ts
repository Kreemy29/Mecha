import { NextRequest, NextResponse } from "next/server";
import { generateSearchPrompts } from "@/lib/services/grok";

export async function POST(request: NextRequest) {
  const { presetSeed, count } = await request.json();

  if (!presetSeed) {
    return NextResponse.json(
      { error: "presetSeed is required" },
      { status: 400 }
    );
  }

  try {
    const prompts = await generateSearchPrompts(presetSeed, count || 5);
    return NextResponse.json({ prompts });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
