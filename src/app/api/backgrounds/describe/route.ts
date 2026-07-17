import { NextRequest, NextResponse } from "next/server";
import { describeBackground } from "@/lib/services/grok";

// Describe a location image ONCE. The returned text is meant to be frozen and
// reused verbatim so the same backdrop renders identically every time.
export async function POST(request: NextRequest) {
  const { imageUrl } = await request.json();
  if (!imageUrl) {
    return NextResponse.json({ error: "imageUrl is required" }, { status: 400 });
  }
  try {
    const description = await describeBackground(imageUrl);
    return NextResponse.json({ description });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
