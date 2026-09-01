import fs from "fs";
import path from "path";
import crypto from "crypto";
import { db, rawDb, schema } from "@/lib/db";

// instagram-scraper-stable-api (RapidAPI) client + normalizers for the
// Instagram browser page. Migrated from instagram120, which RapidAPI delisted
// entirely (its whole listing 404s now, not just individual endpoints).
// Endpoints here are a mix of GET-with-query and POST-with-form-body, but the
// response bodies are still Instagram private-API-shaped JSON, so every
// normalizer below stays deliberately tolerant: walk the structure, take what
// we recognize.

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

export const IG_DEFAULT_HOST = "instagram-scraper-stable-api.p.rapidapi.com";

// ── Low-level API call ──
// Transient failures (5xx, 429, network) are retried with a short backoff.
// Genuine 4xx — bad key, unknown username — fail fast, since retrying can't
// fix them. (instagram120, the previous provider, needed this for flaky deep
// pagination; kept here since a provider swap is no reason to trust a
// scraper API's reliability by default.)
const RETRYABLE_ATTEMPTS = 3;

// Endpoints are a mix of GET-with-query-string and POST-with-form-body —
// unlike instagram120, which was uniformly JSON POST. `params` becomes the
// query string (GET) or the x-www-form-urlencoded body (POST).
async function igFetch(
  method: "GET" | "POST",
  path: string,
  params: Record<string, unknown>
): Promise<unknown> {
  const apiKey = process.env.RAPIDAPI_KEY;
  const host = process.env.RAPIDAPI_INSTAGRAM_HOST || IG_DEFAULT_HOST;
  if (!apiKey) {
    throw new Error("RAPIDAPI_KEY must be configured in .env.local");
  }

  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) qs.set(k, String(v ?? ""));

  let lastError = "";
  for (let attempt = 0; attempt <= RETRYABLE_ATTEMPTS; attempt++) {
    if (attempt > 0) await sleep(500 * attempt);

    let res: Response;
    try {
      const url =
        method === "GET"
          ? `https://${host}/${path}?${qs.toString()}`
          : `https://${host}/${path}`;
      res = await fetch(url, {
        method,
        headers: {
          "x-rapidapi-key": apiKey,
          "x-rapidapi-host": host,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: method === "POST" ? qs.toString() : undefined,
      });
    } catch (err) {
      // Network/TLS blip — worth another go.
      lastError = err instanceof Error ? err.message : String(err);
      continue;
    }

    const text = await res.text();

    if (res.ok) {
      try {
        const data = JSON.parse(text);
        // Some failures arrive as 200 with success:false — treat as retryable.
        if (data && typeof data === "object" && data.success === false) {
          lastError = text.slice(0, 200);
          continue;
        }
        return data;
      } catch {
        lastError = `unparseable response: ${text.slice(0, 200)}`;
        continue;
      }
    }

    if (res.status < 500 && res.status !== 429) {
      throw new Error(
        `${host} ${path} (${res.status}): ${text.slice(0, 300)}`
      );
    }
    lastError = `${res.status}: ${text.slice(0, 200)}`;
  }

  throw new Error(
    `${host} ${path} failed after ${RETRYABLE_ATTEMPTS + 1} attempts — ${lastError}`
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
  const data = await igFetch("POST", "ig_get_fb_profile_v3.php", {
    username_or_url: username,
  });
  // Shape: the user object flat at the top level (unlike instagram120, which
  // wrapped it in { result: [ { user: {...} } ] }) — but walk defensively in
  // case a variant response still nests it.
  let user = asObj(data);
  if (user && !user.username && !user.pk) {
    user = asObj(asObj(user.result)?.user) ?? asObj(user.user) ?? user;
  }
  if (!user) {
    throw new Error(`Account "${username}" not found (or API shape changed)`);
  }

  // Prefer the HD avatar when present.
  const hd = asObj(user.hd_profile_pic_url_info);
  const hdVersions = Array.isArray(user.hd_profile_pic_versions)
    ? user.hd_profile_pic_versions
    : [];
  const bestVersion = asObj(hdVersions[hdVersions.length - 1]);
  const profilePicUrl =
    asStr(hd?.url) || asStr(bestVersion?.url) || asStr(user.profile_pic_url);

  return {
    pk: asStr(user.pk) || String(user.pk ?? ""),
    username: asStr(user.username) || username,
    fullName: asStr(user.full_name),
    biography: asStr(user.biography),
    followerCount: asNum(user.follower_count) ?? 0,
    mediaCount: asNum(user.media_count) ?? 0,
    profilePicUrl,
  };
}

// Pick a reasonably sized thumbnail (~480px) from image_versions2 candidates.
function pickThumbnail(media: Json): string {
  const iv = asObj(media.image_versions2);
  const candidates = Array.isArray(iv?.candidates) ? iv.candidates : [];
  const parsed = candidates
    .map((c) => asObj(c))
    .filter((c): c is Json => !!c && !!asStr(c.url))
    .map((c) => ({ url: asStr(c.url), width: asNum(c.width) ?? 0 }));
  if (parsed.length === 0) return "";
  const mid = parsed.filter((c) => c.width >= 320 && c.width <= 720);
  return (mid[0] || parsed[0]).url;
}

function normalizeMedia(media: Json): IgFeedItem | null {
  const shortcode = asStr(media.code);
  if (!shortcode) return null;
  const captionObj = asObj(media.caption);
  return {
    pk: asStr(media.pk) || String(media.pk ?? ""),
    shortcode,
    thumbnailUrl: pickThumbnail(media),
    caption: asStr(captionObj?.text),
    playCount: asNum(media.play_count) ?? asNum(media.view_count),
    likeCount: asNum(media.like_count),
    commentCount: asNum(media.comment_count),
    takenAt: asNum(media.taken_at),
    isVideo: asNum(media.media_type) === 2 || asStr(media.product_type) === "clips",
  };
}

// ── reels / posts → feed page ──
// Both shapes are { <reels|posts>: [{ node: {...} }], pagination_token } —
// confirmed against the live API. Reels nest the media under node.media;
// posts have the fields flat on node itself, hence the `?? node` fallback.
const FEED_PATH: Record<"reels" | "posts", string> = {
  reels: "get_ig_user_reels.php",
  posts: "get_ig_user_posts.php",
};

export async function fetchFeed(
  username: string,
  kind: "reels" | "posts",
  maxId?: string
): Promise<IgFeedPage> {
  const data = await igFetch("POST", FEED_PATH[kind], {
    username_or_url: username,
    amount: 20,
    pagination_token: maxId || "",
  });
  const result = data as Json;

  const items: IgFeedItem[] = [];
  const list = result[kind];
  if (Array.isArray(list)) {
    for (const raw of list) {
      const node = asObj(asObj(raw)?.node);
      const media = asObj(node?.media) ?? node;
      if (!media) continue;
      const item = normalizeMedia(media);
      if (item) items.push(item);
    }
  }

  // The provider doesn't send an explicit "no more pages" flag (unlike
  // instagram120's has_next_page/more_available) — an empty token is the only
  // signal available, so a stale token could still offer one dead-end page.
  const nextMaxId = asStr(result.pagination_token) || null;

  return { items, nextMaxId };
}

// ── Hover-preview video URL resolution ──
// The reels feed carries no video URL, so previews resolve one on demand via
// mediaByShortcode. CDN URLs expire, hence the short-lived in-memory cache
// (one API call per shortcode per ~30 min, not per hover).
const videoUrlCache = new Map<string, { url: string; at: number }>();
const VIDEO_URL_TTL_MS = 30 * 60 * 1000;

function findMp4Url(obj: unknown): string | null {
  if (typeof obj === "string") return null;
  if (Array.isArray(obj)) {
    for (const v of obj) {
      const found = findMp4Url(v);
      if (found) return found;
    }
    return null;
  }
  const rec = asObj(obj);
  if (!rec) return null;
  // video_versions is the canonical spot; generic .mp4 keys as fallback.
  const versions = rec.video_versions;
  if (Array.isArray(versions)) {
    const url = asStr(asObj(versions[0])?.url);
    if (url) return url;
  }
  for (const key of ["video_url", "videoUrl", "video", "download_url", "url"]) {
    const val = rec[key];
    if (typeof val === "string" && /^https?:\/\/.*\.mp4/i.test(val)) return val;
  }
  for (const v of Object.values(rec)) {
    const found = findMp4Url(v);
    if (found) return found;
  }
  return null;
}

export async function fetchVideoUrl(shortcode: string): Promise<string> {
  const hit = videoUrlCache.get(shortcode);
  if (hit && Date.now() - hit.at < VIDEO_URL_TTL_MS) return hit.url;
  const data = await igFetch("GET", "get_media_data.php", {
    reel_post_code_or_url: shortcode,
    type: "reel",
  });
  const url = findMp4Url(data);
  if (!url) throw new Error(`No video URL found for ${shortcode}`);
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
