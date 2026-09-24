import { NextResponse } from "next/server";
import { requireUser } from "@/lib/services/auth";
import { apifyRun } from "@/lib/services/instagram";

// Resolve an Instagram shortcode to a playable mp4 + poster, server-side.
// Copied from OneUp Insights (api/marketing/reel/[shortcode]).
//
// The mp4 URL is signed and short-lived (~34h), so it is never stored.
// Instagram's own public embed page returns the media object, including a
// FRESH video_url and display_url, for free and without auth. Cached
// in-process well inside the lease, so a page of reels costs one upstream
// fetch per reel per TTL rather than one per view.
//
// ?kind=carousel asks for /p/ rather than /reel/: a carousel has no video,
// and its poster is the first slide.

type Resolved = { videoUrl: string | null; posterUrl: string | null; isVideo: boolean };

/** Comfortably under the ~34h signature lease, with room for a slow day. */
const TTL_MS = 6 * 60 * 60 * 1000;

const cache = new Map<string, { at: number; data: Resolved }>();

/** Instagram double-escapes the JSON inside the embed's script tag. This is a
 *  one-field extraction, not a parse, so dropping every backslash and reading the
 *  URLs out is both sufficient and hard to break. */
function extract(html: string): Resolved {
  const flat = html.split("\\").join("").split("&amp;").join("&");
  const video = flat.match(/https:\/\/[^"\s]+?\.mp4[^"\s]*/);
  const poster =
    flat.match(/"display_url":"(https:\/\/[^"\s]+)"/) ??
    // Some embeds (notably carousels) only carry the image in the markup.
    flat.match(/class="EmbeddedMediaImage"[^>]*src="(https:\/\/[^"\s]+)"/);
  return {
    isVideo: flat.includes('"is_video":true'),
    videoUrl: video ? video[0] : null,
    posterUrl: poster ? poster[1] : null,
  };
}

// Mecha addition. Some posts can't be embedded (the owner turned embedding off,
// or it's age-restricted): the embed page answers 200 with no media. For those
// the viewer can ask for a scrape of that one post through Apify. It costs
// credits, so it only ever runs on an explicit click (?deep=1), never for a
// page of cards.
async function viaApify(shortcode: string, kind: "reel" | "p"): Promise<Resolved> {
  const items = await apifyRun({
    directUrls: [`https://www.instagram.com/${kind}/${shortcode}/`],
    resultsType: kind === "reel" ? "reels" : "posts",
    resultsLimit: 1,
  });
  const item = (items[0] ?? {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" && v ? v : null);
  const videoUrl = str(item.videoUrl);
  return { videoUrl, posterUrl: str(item.displayUrl), isVideo: !!videoUrl };
}

export async function GET(req: Request, ctx: { params: Promise<{ shortcode: string }> }) {
  const { deny } = await requireUser();
  if (deny) return deny;
  const { shortcode } = await ctx.params;
  const sp = new URL(req.url).searchParams;
  const kind = sp.get("kind") === "carousel" ? "p" : "reel";
  const deep = sp.get("deep") === "1";

  // The shortcode goes straight into an outbound URL, so it is whitelisted rather
  // than trusted: Instagram shortcodes are base64url and nothing else.
  if (!/^[A-Za-z0-9_-]{5,32}$/.test(shortcode)) {
    return NextResponse.json({ error: "bad shortcode" }, { status: 400 });
  }

  const key = `${kind}:${shortcode}`;
  const hit = cache.get(key);
  // A cached "no media" answer doesn't block an explicit deep request.
  if (hit && Date.now() - hit.at < TTL_MS && !(deep && !hit.data.posterUrl)) {
    return NextResponse.json(hit.data, { headers: { "x-cache": "hit" } });
  }

  if (deep) {
    try {
      const data = await viaApify(shortcode, kind);
      if (data.posterUrl || data.videoUrl) cache.set(key, { at: Date.now(), data });
      return NextResponse.json(data);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return NextResponse.json({ error: msg }, { status: 502 });
    }
  }

  try {
    const res = await fetch(`https://www.instagram.com/${kind}/${shortcode}/embed/`, {
      headers: { "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" },
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      return NextResponse.json({ error: "upstream", status: res.status }, { status: 502 });
    }

    const data = extract(await res.text());
    // A deleted or private post still returns 200 with no media. Cache that too,
    // or every render retries a post that is never coming back.
    cache.set(key, { at: Date.now(), data });
    return NextResponse.json(data, { headers: { "x-cache": "miss" } });
  } catch {
    return NextResponse.json({ error: "unreachable" }, { status: 504 });
  }
}
