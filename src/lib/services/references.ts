import fs from "fs";
import path from "path";
import { execSync } from "child_process";

const STORAGE_DIR = path.resolve("./storage/references");

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function fileId(): string {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// ── Pinterest Search ──

interface PinterestResult {
  imageUrl: string;
  thumbnailUrl: string;
  title: string;
  sourceUrl: string;
}

const PINTEREST_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  Accept: "application/json, text/javascript, */*, q=0.01",
  "Accept-Language": "en-US,en;q=0.9",
  "X-Requested-With": "XMLHttpRequest",
  "X-APP-VERSION": "feedback",
  "x-pinterest-pws-handler": "www/search/[scope].js",
  Referer: "https://www.pinterest.com/",
};

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

interface PinImage {
  url?: string;
}
interface Pin {
  id?: string;
  type?: string;
  title?: string;
  grid_title?: string;
  description?: string;
  images?: Record<string, PinImage>;
}

function mapPin(pin: Pin): PinterestResult | null {
  const imgs = pin.images || {};
  const imageUrl =
    imgs.orig?.url ||
    imgs["736x"]?.url ||
    imgs["564x"]?.url ||
    imgs["474x"]?.url ||
    "";
  const thumbnailUrl =
    imgs["236x"]?.url || imgs["170x"]?.url || imgs["236x"]?.url || imageUrl;
  if (!imageUrl) return null;
  return {
    imageUrl,
    thumbnailUrl,
    title: pin.grid_title || pin.title || pin.description || "",
    sourceUrl: pin.id ? `https://www.pinterest.com/pin/${pin.id}/` : "",
  };
}

// Native Pinterest search via the site's internal BaseSearchResource endpoint.
// No API key required. Paginates with bookmarks.
async function searchPinterestNative(
  query: string,
  pages: number
): Promise<PinterestResult[]> {
  const results: PinterestResult[] = [];
  const seen = new Set<string>();
  let bookmark: string | undefined;

  for (let page = 0; page < pages; page++) {
    const options: Record<string, unknown> = {
      query,
      scope: "pins",
      page_size: 25,
    };
    if (bookmark) options.bookmarks = [bookmark];

    const data = encodeURIComponent(JSON.stringify({ options, context: {} }));
    const sourceUrl = encodeURIComponent(`/search/pins/?q=${query}`);
    const url = `https://www.pinterest.com/resource/BaseSearchResource/get/?source_url=${sourceUrl}&data=${data}`;

    let res: Response;
    try {
      res = await fetch(url, { headers: PINTEREST_HEADERS });
    } catch (err) {
      console.error("[Pinterest] fetch failed:", err);
      break;
    }

    if (!res.ok) {
      // Surface the first-page failure; tolerate later-page hiccups.
      if (page === 0) {
        throw new Error(
          `Pinterest search failed (${res.status}). The internal endpoint may be rate-limiting — try again shortly.`
        );
      }
      break;
    }

    const json = await res.json();
    const pins: Pin[] = json?.resource_response?.data?.results || [];

    for (const pin of pins) {
      if (pin.type && pin.type !== "pin") continue;
      const mapped = mapPin(pin);
      if (mapped && !seen.has(mapped.imageUrl)) {
        seen.add(mapped.imageUrl);
        results.push(mapped);
      }
    }

    bookmark = json?.resource_response?.bookmark;
    if (!bookmark || bookmark === "-end-") break;

    // gentle pacing to avoid rate limits
    if (page < pages - 1) await sleep(600);
  }

  return results;
}

// RapidAPI fallback (only if RAPIDAPI_PINTEREST_HOST is configured).
async function searchPinterestRapidApi(
  query: string,
  pages: number,
  apiKey: string,
  host: string
): Promise<PinterestResult[]> {
  const results: PinterestResult[] = [];
  let bookmark = "";

  for (let page = 0; page < pages; page++) {
    const url = new URL(`https://${host}/search/pins`);
    url.searchParams.set("query", query);
    if (bookmark) url.searchParams.set("bookmark", bookmark);

    const res = await fetch(url.toString(), {
      headers: { "x-rapidapi-key": apiKey, "x-rapidapi-host": host },
    });
    if (!res.ok) {
      if (page === 0)
        throw new Error(`Pinterest API error (${res.status}): ${await res.text()}`);
      break;
    }

    const data = await res.json();
    const pins = data.data || data.results || data.pins || [];
    for (const pin of pins) {
      const mapped = mapPin(pin as Pin);
      if (mapped) results.push(mapped);
    }
    bookmark = data.bookmark || "";
    if (!bookmark) break;
  }
  return results;
}

export async function searchPinterest(
  query: string,
  pages: number = 3
): Promise<PinterestResult[]> {
  const apiKey = process.env.RAPIDAPI_KEY;
  const host = process.env.RAPIDAPI_PINTEREST_HOST;

  // Prefer RapidAPI only if explicitly configured; otherwise use the free native endpoint.
  if (apiKey && host) {
    return searchPinterestRapidApi(query, pages, apiKey, host);
  }
  return searchPinterestNative(query, pages);
}

// ── Instagram Reel Download (instagram120 mediaByShortcode) ──

// Extract the shortcode from an Instagram reel/post URL.
// e.g. https://www.instagram.com/reel/DPRcWdvgI4P/ -> DPRcWdvgI4P
export function extractInstagramShortcode(url: string): string | null {
  const m = url.match(/instagram\.com\/(?:reel|reels|p|tv)\/([A-Za-z0-9_-]+)/);
  return m ? m[1] : null;
}

// Deeply scan an object for the first .mp4 video url.
function findVideoUrl(obj: unknown): string | null {
  if (!obj) return null;
  if (typeof obj === "string") {
    return /^https?:\/\/.*\.mp4/i.test(obj) ? obj : null;
  }
  if (Array.isArray(obj)) {
    for (const v of obj) {
      const found = findVideoUrl(v);
      if (found) return found;
    }
    return null;
  }
  if (typeof obj === "object") {
    const rec = obj as Record<string, unknown>;
    // Prefer explicit video keys first
    for (const key of ["video_url", "videoUrl", "video", "download_url", "url"]) {
      const val = rec[key];
      if (typeof val === "string" && /^https?:\/\/.*\.mp4/i.test(val)) return val;
    }
    for (const v of Object.values(rec)) {
      const found = findVideoUrl(v);
      if (found) return found;
    }
  }
  return null;
}

export async function downloadInstagramReel(
  reelUrl: string
): Promise<{ videoPath: string; framePath: string }> {
  const apiKey = process.env.RAPIDAPI_KEY;
  const host = process.env.RAPIDAPI_INSTAGRAM_HOST || "instagram120.p.rapidapi.com";
  if (!apiKey) {
    throw new Error("RAPIDAPI_KEY must be configured");
  }

  const shortcode = extractInstagramShortcode(reelUrl);
  if (!shortcode) {
    throw new Error(`Could not parse Instagram shortcode from URL: ${reelUrl}`);
  }

  const res = await fetch(`https://${host}/api/instagram/mediaByShortcode`, {
    method: "POST",
    headers: {
      "x-rapidapi-key": apiKey,
      "x-rapidapi-host": host,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ shortcode }),
  });

  if (!res.ok) {
    throw new Error(`Instagram API error (${res.status}): ${await res.text()}`);
  }

  const data = await res.json();
  const videoUrl = findVideoUrl(data);

  if (!videoUrl) {
    throw new Error(
      `Could not extract video URL from Instagram response: ${JSON.stringify(data).slice(0, 300)}`
    );
  }

  // Download video
  ensureDir(STORAGE_DIR);
  const id = fileId();
  const videoPath = path.join(STORAGE_DIR, `${id}.mp4`);
  const videoRes = await fetch(videoUrl);
  const videoBuffer = Buffer.from(await videoRes.arrayBuffer());
  fs.writeFileSync(videoPath, videoBuffer);

  // Extract first frame with ffmpeg
  const framePath = path.join(STORAGE_DIR, `${id}_frame.jpg`);
  try {
    execSync(
      `ffmpeg -i "${videoPath}" -vframes 1 -q:v 2 "${framePath}" -y`,
      { stdio: "pipe" }
    );
  } catch (err) {
    console.error("ffmpeg frame extraction failed:", err);
    // If ffmpeg fails, return without frame
    return {
      videoPath: path.relative(process.cwd(), videoPath),
      framePath: "",
    };
  }

  return {
    videoPath: path.relative(process.cwd(), videoPath),
    framePath: path.relative(process.cwd(), framePath),
  };
}

// ── Download a reference image locally ──

export async function downloadImage(
  imageUrl: string
): Promise<string> {
  ensureDir(STORAGE_DIR);
  const id = fileId();
  const ext = imageUrl.match(/\.(jpg|jpeg|png|webp)/i)?.[1] || "jpg";
  const filePath = path.join(STORAGE_DIR, `${id}.${ext}`);

  const res = await fetch(imageUrl);
  if (!res.ok) throw new Error(`Failed to download image: ${res.status}`);

  const buffer = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(filePath, buffer);

  return path.relative(process.cwd(), filePath);
}
