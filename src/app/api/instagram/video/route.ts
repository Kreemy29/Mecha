import { NextRequest, NextResponse } from "next/server";
import { fetchVideoUrl } from "@/lib/services/instagram";

// Resolve a shortcode to a playable CDN video URL for hover previews.
// GET /api/instagram/video?shortcode=XYZ → { url }
export async function GET(request: NextRequest) {
  const shortcode = request.nextUrl.searchParams.get("shortcode") || "";
  if (!shortcode) {
    return NextResponse.json({ error: "shortcode required" }, { status: 400 });
  }
  try {
    const url = await fetchVideoUrl(shortcode);
    return NextResponse.json({ url });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
