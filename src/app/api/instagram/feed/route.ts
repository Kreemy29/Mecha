import { NextRequest, NextResponse } from "next/server";
import { fetchFeed, savedShortcodes } from "@/lib/services/instagram";

// Live feed for a username (not persisted — saving is explicit).
// GET /api/instagram/feed?username=foo&kind=reels|posts&maxId=...
export async function GET(request: NextRequest) {
  try {
    const sp = request.nextUrl.searchParams;
    const username = (sp.get("username") || "").trim().replace(/^@/, "");
    const kind = sp.get("kind") === "posts" ? "posts" : "reels";
    const maxId = sp.get("maxId") || undefined;
    if (!username) {
      return NextResponse.json({ error: "username required" }, { status: 400 });
    }

    const page = await fetchFeed(username, kind, maxId);
    const saved = savedShortcodes();
    return NextResponse.json({
      items: page.items.map((item) => ({
        ...item,
        saved: saved.has(item.shortcode),
      })),
      nextMaxId: page.nextMaxId,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
