import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { cacheImage } from "@/lib/services/instagram";

// Thumbnail proxy with a disk cache. IG CDN URLs expire and are sometimes
// hotlink-blocked, so the browser never loads them directly — everything goes
// through here and lands in storage/instagram/.
export async function GET(request: NextRequest) {
  const url = request.nextUrl.searchParams.get("url") || "";
  if (!/^https:\/\/[^/]*(cdninstagram|fbcdn)[^/]*\//.test(url)) {
    return NextResponse.json({ error: "unsupported url" }, { status: 400 });
  }
  try {
    const rel = await cacheImage(url);
    const buf = fs.readFileSync(path.resolve(rel));
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        "Content-Type": "image/jpeg",
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
