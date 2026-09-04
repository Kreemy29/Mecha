import fs from "fs";
import path from "path";
import crypto from "crypto";
import { db, rawDb, schema } from "@/lib/db";

// Apify (apify/instagram-scraper actor) client + normalizers for the
// Instagram browser page. Second migration in short order — first off
// instagram120 (RapidAPI delisted it entirely), then off
// instagram-scraper-stable-api (also RapidAPI) onto Apify, a proper scraping
// platform rather than a single-developer RapidAPI reseller. One actor run
// returns a JSON array of item objects with clean camelCase fields — no more
// wrestling with Instagram's raw private-API shapes, but every normalizer
// below still stays tolerant since a scraper's output can shift.

const IG_CACHE_DIR = path.resolve("./storage/instagram");

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

// ── Runtime table creation ──
// `db:push` drops/recreates tables and has wiped hand-made data before
// (HANDOFF §8.3), so the IG tables are created directly. Safe to call often.
let tablesEnsured = false;
export function ensureInstagramTables(): void {
  if (tablesEnsured) return;
  rawDb.exec(`
    CREATE TABLE IF NOT EXISTS ig_accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      ig_pk TEXT,
      full_name TEXT,
      biography TEXT,
      profile_pic_path TEXT,
      follower_count INTEGER,
      media_count INTEGER,
      last_synced_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS ig_media (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id INTEGER REFERENCES ig_accounts(id),
      shortcode TEXT NOT NULL UNIQUE,
      ig_pk TEXT,
      caption TEXT,
      thumb_path TEXT,
      video_path TEXT,
      play_count INTEGER,
      like_count INTEGER,
      comment_count INTEGER,
      taken_at INTEGER,
      duration_seconds REAL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS ig_taxonomy (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kind TEXT NOT NULL,
      value TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS ig_taxonomy_kind_value
      ON ig_taxonomy (kind, value);
    CREATE TABLE IF NOT EXISTS ig_account_tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id INTEGER NOT NULL REFERENCES ig_accounts(id),
      kind TEXT NOT NULL,
      value TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS ig_account_tags_unique
      ON ig_account_tags (account_id, kind, value);
    CREATE TABLE IF NOT EXISTS ig_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      media_id INTEGER NOT NULL REFERENCES ig_media(id),
      queue TEXT NOT NULL,
      comment TEXT,
      model TEXT,
      format_id INTEGER,
      assigned_by TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS ig_requests_queue ON ig_requests (queue, status);
    CREATE TABLE IF NOT EXISTS ig_request_comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      request_id INTEGER NOT NULL REFERENCES ig_requests(id),
      author TEXT NOT NULL,
      body TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS ig_request_comments_request
      ON ig_request_comments (request_id);
    CREATE TABLE IF NOT EXISTS winning_formats (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      queue TEXT NOT NULL,
      title TEXT NOT NULL,
      video_path TEXT,
      thumb_path TEXT,
      source_url TEXT,
      shortcode TEXT,
      notes TEXT,
      added_by TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS winning_formats_queue ON winning_formats (queue);
  `);

  // Columns added after the table shipped — CREATE TABLE IF NOT EXISTS is a
  // no-op on an existing table, so add them explicitly.
  const columns = rawDb
    .prepare("PRAGMA table_info(ig_accounts)")
    .all() as Array<{ name: string }>;
  const have = new Set(columns.map((c) => c.name));
  if (!have.has("model_name")) {
    rawDb.exec("ALTER TABLE ig_accounts ADD COLUMN model_name TEXT");
  }
  if (!have.has("niche")) {
    rawDb.exec("ALTER TABLE ig_accounts ADD COLUMN niche TEXT");
  }

  // One-time lift of the old single-value columns into the join table, so tags
  // set before multi-assign shipped aren't lost. INSERT OR IGNORE + the unique
  // index make this safe to re-run.
  rawDb.exec(`
    INSERT OR IGNORE INTO ig_account_tags (account_id, kind, value)
      SELECT id, 'model', TRIM(model_name) FROM ig_accounts
      WHERE model_name IS NOT NULL AND TRIM(model_name) <> '';
    INSERT OR IGNORE INTO ig_account_tags (account_id, kind, value)
      SELECT id, 'niche', TRIM(niche) FROM ig_accounts
      WHERE niche IS NOT NULL AND TRIM(niche) <> '';
  `);

  tablesEnsured = true;
}

// Replace an account's tags of one kind. Passing undefined leaves them alone
// (a plain profile refresh must not clear them).
export function setAccountTags(
  accountId: number,
  kind: "model" | "niche",
  values: string[] | undefined
): void {
  if (values === undefined) return;
  ensureInstagramTables();
  const clean = [...new Set(values.map((v) => v.trim()).filter(Boolean))];
  rawDb
    .prepare("DELETE FROM ig_account_tags WHERE account_id = ? AND kind = ?")
    .run(accountId, kind);
  const insert = rawDb.prepare(
    "INSERT OR IGNORE INTO ig_account_tags (account_id, kind, value) VALUES (?, ?, ?)"
  );
  for (const value of clean) {
    insert.run(accountId, kind, value);
    rememberTaxonomy(kind, value);
  }
}

// accountId → { models, niches }, for decorating account rows.
export function tagsByAccount(): Map<
  number,
  { models: string[]; niches: string[] }
> {
  ensureInstagramTables();
  const rows = rawDb
    .prepare("SELECT account_id, kind, value FROM ig_account_tags")
    .all() as Array<{ account_id: number; kind: string; value: string }>;
  const map = new Map<number, { models: string[]; niches: string[] }>();
  for (const r of rows) {
    let entry = map.get(r.account_id);
    if (!entry) {
      entry = { models: [], niches: [] };
      map.set(r.account_id, entry);
    }
    (r.kind === "model" ? entry.models : entry.niches).push(r.value);
  }
  for (const entry of map.values()) {
    entry.models.sort((a, b) => a.localeCompare(b));
    entry.niches.sort((a, b) => a.localeCompare(b));
  }
  return map;
}

// Accounts carrying a given tag — the basis for "saved videos for this niche".
export function accountIdsWithTag(kind: "model" | "niche", value: string): number[] {
  ensureInstagramTables();
  const rows = rawDb
    .prepare("SELECT account_id FROM ig_account_tags WHERE kind = ? AND value = ?")
    .all(kind, value) as Array<{ account_id: number }>;
  return rows.map((r) => r.account_id);
}

// Record a model/niche value so it shows up as an option next time. Ignores
// blanks and duplicates (the unique index does the dedupe).
export function rememberTaxonomy(kind: "model" | "niche", value: string): void {
  const clean = value.trim();
  if (!clean) return;
  ensureInstagramTables();
  rawDb
    .prepare("INSERT OR IGNORE INTO ig_taxonomy (kind, value) VALUES (?, ?)")
    .run(kind, clean);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const APIFY_ACTOR = "apify~instagram-scraper";

// ── Low-level API call ──
// run-sync-get-dataset-items starts the actor run and blocks until it
// finishes (or ~5 min, whichever first), returning the scraped items
// directly — no separate poll step needed. Each call already takes ~10-25s
// even on a small request, so retries are capped at 1 extra attempt rather
// than the 3 a plain HTTP call could afford — three retries here could push
// a single logical call past a minute.
const RETRYABLE_ATTEMPTS = 1;

export async function apifyRun(input: Record<string, unknown>): Promise<unknown[]> {
  const token = process.env.APIFY_TOKEN;
  if (!token) {
    throw new Error("APIFY_TOKEN must be configured in .env.local");
  }

  let lastError = "";
  for (let attempt = 0; attempt <= RETRYABLE_ATTEMPTS; attempt++) {
    if (attempt > 0) await sleep(1000 * attempt);

    let res: Response;
    try {
      res = await fetch(
        `https://api.apify.com/v2/acts/${APIFY_ACTOR}/run-sync-get-dataset-items`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(input),
        }
      );
    } catch (err) {
      // Network/TLS blip — worth another go.
      lastError = err instanceof Error ? err.message : String(err);
      continue;
    }

    const text = await res.text();

    if (res.ok) {
      try {
        const data = JSON.parse(text);
        if (!Array.isArray(data)) {
          lastError = `expected an array, got: ${text.slice(0, 200)}`;
          continue;
        }
        return data;
      } catch {
        lastError = `unparseable response: ${text.slice(0, 200)}`;
        continue;
      }
    }

    if (res.status < 500 && res.status !== 429) {
      throw new Error(`apify instagram-scraper (${res.status}): ${text.slice(0, 300)}`);
    }
    lastError = `${res.status}: ${text.slice(0, 200)}`;
  }

  throw new Error(
    `apify instagram-scraper failed after ${RETRYABLE_ATTEMPTS + 1} attempts — ${lastError}`
  );
}

// ── Normalized shapes the UI consumes ──
export interface IgProfile {
  pk: string;
  username: string;
  fullName: string;
  biography: string;
  followerCount: number;
  mediaCount: number;
  profilePicUrl: string;
}

export interface IgFeedItem {
  pk: string;
  shortcode: string;
  thumbnailUrl: string;
  caption: string;
  playCount: number | null;
  likeCount: number | null;
  commentCount: number | null;
  takenAt: number | null; // unix seconds
  isVideo: boolean;
}

export interface IgFeedPage {
  items: IgFeedItem[];
  nextMaxId: string | null;
}

type Json = Record<string, unknown>;
const asObj = (v: unknown): Json | null =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : null;
const asStr = (v: unknown): string => (typeof v === "string" ? v : "");
const asNum = (v: unknown): number | null =>
  typeof v === "number" && isFinite(v) ? v : null;

// ── profile ──
export async function fetchProfile(username: string): Promise<IgProfile> {
  const items = await apifyRun({
    directUrls: [`https://www.instagram.com/${username}/`],
    resultsType: "details",
    resultsLimit: 1,
  });
  const user = asObj(items[0]);
  if (!user || (!user.username && !user.id)) {
    throw new Error(`Account "${username}" not found (or API shape changed)`);
  }

  return {
    pk: asStr(user.id) || String(user.id ?? ""),
    username: asStr(user.username) || username,
    fullName: asStr(user.fullName),
    biography: asStr(user.biography),
    followerCount: asNum(user.followersCount) ?? 0,
    mediaCount: asNum(user.postsCount) ?? 0,
    // HD version is a plain field here — no more digging through a
    // hd_profile_pic_url_info/hd_profile_pic_versions[] wrapper.
    profilePicUrl: asStr(user.profilePicUrlHD) || asStr(user.profilePicUrl),
  };
}

function normalizeMedia(item: Json): IgFeedItem | null {
  const shortcode = asStr(item.shortCode);
  if (!shortcode) return null;
  const images = Array.isArray(item.images) ? item.images : [];
  const timestamp = asStr(item.timestamp); // ISO string, unlike prior providers' unix seconds
  return {
    pk: asStr(item.id) || String(item.id ?? ""),
    shortcode,
    thumbnailUrl: asStr(item.displayUrl) || asStr(images[0]),
    caption: asStr(item.caption),
    playCount: asNum(item.videoPlayCount) ?? asNum(item.videoViewCount),
    likeCount: asNum(item.likesCount),
    commentCount: asNum(item.commentsCount),
    takenAt: timestamp ? Math.floor(new Date(timestamp).getTime() / 1000) : null,
    isVideo: item.type === "Video" || asStr(item.productType) === "clips",
  };
}

// ── reels / posts → feed page ──
// Apify has no incremental cursor the way both prior providers did — one run
// just returns up to `resultsLimit` items from the top of the profile's feed.
// "Load more" here means re-running with a bigger limit and slicing off what
// was already shown: correct, but it re-scrapes (and re-bills) the earlier
// items on every page rather than fetching only what's new. Fine for a few
// pages of browsing, not free for scrolling deep into a feed. `maxId` doubles
// as "how many items already shown".
const FEED_PAGE_SIZE = 20;

export async function fetchFeed(
  username: string,
  kind: "reels" | "posts",
  maxId?: string
): Promise<IgFeedPage> {
  const alreadyShown = maxId ? parseInt(maxId, 10) || 0 : 0;
  const resultsLimit = alreadyShown + FEED_PAGE_SIZE;

  const items = await apifyRun({
    directUrls: [`https://www.instagram.com/${username}/`],
    resultsType: kind,
    resultsLimit,
  });

  const page = items
    .map((raw) => asObj(raw))
    .slice(alreadyShown)
    .map((obj) => (obj ? normalizeMedia(obj) : null))
    .filter((item): item is IgFeedItem => !!item);

  // Fewer items came back than asked for — the feed is exhausted.
  const nextMaxId = items.length >= resultsLimit ? String(resultsLimit) : null;

  return { items: page, nextMaxId };
}

// ── Video URL resolution by shortcode ──
// Used for both the reels-feed hover preview (fetchVideoUrl below) and reel
// downloads (references.ts's downloadInstagramReel) — the two places that
// only have a bare shortcode/URL and no fresh feed data with a videoUrl
// already on it.
//
// Apify's actor treats /reel/ and /p/ URLs for the same content differently
// — confirmed live: scraping an item under the "wrong" style for its content
// type comes back empty, and the hover preview in particular is used for
// both reels and regular video posts, so the caller often can't know which
// style is right. Try the preferred style, then the other. A single-item
// direct scrape can also get flagged restricted_page by Instagram itself
// regardless of URL style (also confirmed live) — genuinely unavailable, not
// a bug, hence surfacing Apify's own reason rather than a generic message.
export async function resolveVideoUrl(
  shortcode: string,
  preferred: "reel" | "p" = "reel"
): Promise<string> {
  const styles = preferred === "reel" ? (["reel", "p"] as const) : (["p", "reel"] as const);

  let lastItem: Json | null = null;
  for (const urlPath of styles) {
    const items = await apifyRun({
      directUrls: [`https://www.instagram.com/${urlPath}/${shortcode}/`],
      resultsType: urlPath === "reel" ? "reels" : "posts",
      resultsLimit: 1,
    });
    const item = asObj(items[0]);
    lastItem = item;
    const url = asStr(item?.videoUrl);
    if (url) return url;
  }

  const reason = asStr(lastItem?.errorDescription) || asStr(lastItem?.error);
  throw new Error(
    reason
      ? `No video URL for ${shortcode}: ${reason}`
      : `No video URL found for ${shortcode}`
  );
}

// ── Hover-preview video URL resolution ──
// CDN URLs expire, hence the short-lived in-memory cache (one call per
// shortcode per ~30 min, not per hover).
const videoUrlCache = new Map<string, { url: string; at: number }>();
const VIDEO_URL_TTL_MS = 30 * 60 * 1000;

export async function fetchVideoUrl(shortcode: string): Promise<string> {
  const hit = videoUrlCache.get(shortcode);
  if (hit && Date.now() - hit.at < VIDEO_URL_TTL_MS) return hit.url;
  const url = await resolveVideoUrl(shortcode);
  videoUrlCache.set(shortcode, { url, at: Date.now() });
  return url;
}

// ── Local image cache ──
// IG CDN URLs expire (and can be hotlink-blocked), so every thumbnail/avatar
// the UI shows is downloaded once into storage/instagram/ and served from
// /api/files. Keyed by URL path hash so re-fetches of the same asset reuse it.
export async function cacheImage(url: string): Promise<string> {
  if (!url) throw new Error("cacheImage: empty url");
  ensureDir(IG_CACHE_DIR);
  const key = crypto
    .createHash("sha1")
    .update(new URL(url).pathname)
    .digest("hex")
    .slice(0, 20);
  const abs = path.join(IG_CACHE_DIR, `${key}.jpg`);
  if (!fs.existsSync(abs)) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`image fetch failed (${res.status})`);
    fs.writeFileSync(abs, Buffer.from(await res.arrayBuffer()));
  }
  return path.relative(process.cwd(), abs);
}

// All saved shortcodes — used to badge the live feed ("already saved").
export function savedShortcodes(): Set<string> {
  ensureInstagramTables();
  const rows = db
    .select({ shortcode: schema.igMedia.shortcode })
    .from(schema.igMedia)
    .all();
  return new Set(rows.map((r) => r.shortcode));
}
