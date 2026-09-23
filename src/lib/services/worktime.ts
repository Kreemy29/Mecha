import crypto from "crypto";
import { rawDb } from "../db";

// Clock-in/out and browser activity for the department.
//
// A work session is one clock-in → clock-out. `last_seen` is bumped by the
// app's heartbeat and by the Chrome tracker; a session nobody has touched for
// STALE_MS is closed automatically at its last sign of life, so forgetting to
// clock out doesn't bill the whole night.
//
// Activity rows come only from the Chrome extension (extension/): one row per
// stretch of time on one tab, or an idle / away-from-Chrome stretch. They're
// only accepted while the user is clocked in.
//
// All timestamps are ISO-8601 UTC strings, so they sort and compare as text.

const STALE_MS = 2 * 60 * 60 * 1000;
// A single segment longer than this is almost certainly a sleeping laptop the
// idle detector missed — cap it rather than trust it.
const MAX_SEGMENT_SECONDS = 60 * 60;

let ensured = false;
export function ensureWorkTables(): void {
  if (ensured) return;
  rawDb.exec(`
    CREATE TABLE IF NOT EXISTS work_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      clock_in TEXT NOT NULL,
      clock_out TEXT,
      last_seen TEXT NOT NULL,
      auto_closed INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS work_sessions_user ON work_sessions (user_id, clock_in);
    CREATE TABLE IF NOT EXISTS activity (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      session_id INTEGER NOT NULL REFERENCES work_sessions(id),
      kind TEXT NOT NULL,
      domain TEXT,
      url TEXT,
      title TEXT,
      started_at TEXT NOT NULL,
      ended_at TEXT NOT NULL,
      seconds INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS activity_user ON activity (user_id, started_at);
    CREATE TABLE IF NOT EXISTS tracker_keys (
      user_id INTEGER PRIMARY KEY REFERENCES users(id),
      key_hash TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      last_used_at TEXT
    );
  `);
  ensured = true;
}

export interface WorkSession {
  id: number;
  userId: number;
  clockIn: string;
  clockOut: string | null;
  lastSeen: string;
  autoClosed: boolean;
}

interface WorkSessionRow {
  id: number;
  user_id: number;
  clock_in: string;
  clock_out: string | null;
  last_seen: string;
  auto_closed: number;
}

const toSession = (r: WorkSessionRow): WorkSession => ({
  id: r.id,
  userId: r.user_id,
  clockIn: r.clock_in,
  clockOut: r.clock_out,
  lastSeen: r.last_seen,
  autoClosed: !!r.auto_closed,
});

const nowIso = () => new Date().toISOString();

// The user's open session, if any — closing it first if it has gone stale.
export function openSession(userId: number): WorkSession | null {
  ensureWorkTables();
  const row = rawDb
    .prepare(
      "SELECT * FROM work_sessions WHERE user_id = ? AND clock_out IS NULL ORDER BY id DESC LIMIT 1"
    )
    .get(userId) as WorkSessionRow | undefined;
  if (!row) return null;
  if (Date.now() - Date.parse(row.last_seen) > STALE_MS) {
    rawDb
      .prepare("UPDATE work_sessions SET clock_out = last_seen, auto_closed = 1 WHERE id = ?")
      .run(row.id);
    return null;
  }
  return toSession(row);
}

export function clockIn(userId: number): WorkSession {
  const existing = openSession(userId);
  if (existing) return existing;
  const now = nowIso();
  const info = rawDb
    .prepare("INSERT INTO work_sessions (user_id, clock_in, last_seen) VALUES (?, ?, ?)")
    .run(userId, now, now);
  return {
    id: Number(info.lastInsertRowid),
    userId,
    clockIn: now,
    clockOut: null,
    lastSeen: now,
    autoClosed: false,
  };
}

export function clockOut(userId: number): void {
  const open = openSession(userId);
  if (!open) return;
  const now = nowIso();
  rawDb
    .prepare("UPDATE work_sessions SET clock_out = ?, last_seen = ? WHERE id = ?")
    .run(now, now, open.id);
}

// "Still here." Returns the open session (or null when clocked out).
export function heartbeat(userId: number): WorkSession | null {
  const open = openSession(userId);
  if (!open) return null;
  const now = nowIso();
  rawDb.prepare("UPDATE work_sessions SET last_seen = ? WHERE id = ?").run(now, open.id);
  return { ...open, lastSeen: now };
}

// Sessions overlapping [from, to).
export function sessionsBetween(from: string, to: string, userId?: number): WorkSession[] {
  ensureWorkTables();
  const rows = rawDb
    .prepare(
      `SELECT * FROM work_sessions
       WHERE clock_in < ? AND (clock_out IS NULL OR clock_out > ?)
       ${userId ? "AND user_id = ?" : ""}
       ORDER BY clock_in`
    )
    .all(...(userId ? [to, from, userId] : [to, from])) as WorkSessionRow[];
  return rows.map(toSession);
}

// Seconds of a session that fall inside [from, to). An open session counts up
// to its last heartbeat, not "now", so a stale-but-not-yet-closed one doesn't
// inflate the total.
export function secondsWithin(s: WorkSession, from: string, to: string): number {
  const start = Math.max(Date.parse(s.clockIn), Date.parse(from));
  const end = Math.min(Date.parse(s.clockOut ?? s.lastSeen), Date.parse(to));
  return Math.max(0, Math.round((end - start) / 1000));
}

// ── Activity (from the Chrome tracker) ──

export type ActivityKind = "browse" | "idle" | "away";

export interface ActivitySegment {
  kind: ActivityKind;
  url?: string;
  title?: string;
  start: string;
  end: string;
}

function domainOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

// Drop query strings and fragments: they often carry tokens and search terms
// nobody needs in a timesheet.
function cleanUrl(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}${u.pathname}`;
  } catch {
    return null;
  }
}

// Store segments that fall inside the user's open session. Returns how many
// were kept; everything is dropped when they're clocked out.
export function recordActivity(userId: number, segments: ActivitySegment[]): number {
  const open = heartbeat(userId);
  if (!open) return 0;
  const insert = rawDb.prepare(
    `INSERT INTO activity (user_id, session_id, kind, domain, url, title, started_at, ended_at, seconds)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  let kept = 0;
  const tx = rawDb.transaction((list: ActivitySegment[]) => {
    for (const seg of list) {
      if (!["browse", "idle", "away"].includes(seg.kind)) continue;
      const startMs = Math.max(Date.parse(seg.start), Date.parse(open.clockIn));
      const endMs = Math.min(Date.parse(seg.end), Date.now());
      if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) continue;
      const seconds = Math.min(Math.round((endMs - startMs) / 1000), MAX_SEGMENT_SECONDS);
      if (seconds < 1) continue;
      insert.run(
        userId,
        open.id,
        seg.kind,
        seg.kind === "browse" ? domainOf(seg.url) : null,
        seg.kind === "browse" ? cleanUrl(seg.url) : null,
        seg.kind === "browse" ? (seg.title || "").slice(0, 300) : null,
        new Date(startMs).toISOString(),
        new Date(endMs).toISOString(),
        seconds
      );
      kept++;
    }
  });
  tx(segments.slice(0, 500));
  return kept;
}

export interface ActivitySummary {
  browseSeconds: number;
  idleSeconds: number;
  awaySeconds: number;
  domains: Array<{ domain: string; seconds: number }>;
  pages: Array<{ url: string; title: string; seconds: number }>;
  timeline: Array<{
    kind: ActivityKind;
    domain: string | null;
    title: string | null;
    start: string;
    end: string;
  }>;
  lastActivityAt: string | null;
}

export function activitySummary(userId: number, from: string, to: string): ActivitySummary {
  ensureWorkTables();
  const kinds = rawDb
    .prepare(
      `SELECT kind, SUM(seconds) AS s FROM activity
       WHERE user_id = ? AND started_at >= ? AND started_at < ? GROUP BY kind`
    )
    .all(userId, from, to) as Array<{ kind: ActivityKind; s: number }>;
  const byKind = (k: ActivityKind) => kinds.find((r) => r.kind === k)?.s ?? 0;

  const domains = rawDb
    .prepare(
      `SELECT domain, SUM(seconds) AS seconds FROM activity
       WHERE user_id = ? AND kind = 'browse' AND started_at >= ? AND started_at < ?
       GROUP BY domain ORDER BY seconds DESC LIMIT 20`
    )
    .all(userId, from, to) as Array<{ domain: string; seconds: number }>;

  const pages = rawDb
    .prepare(
      `SELECT url, MAX(title) AS title, SUM(seconds) AS seconds FROM activity
       WHERE user_id = ? AND kind = 'browse' AND started_at >= ? AND started_at < ?
       GROUP BY url ORDER BY seconds DESC LIMIT 25`
    )
    .all(userId, from, to) as Array<{ url: string; title: string; seconds: number }>;

  const timeline = rawDb
    .prepare(
      `SELECT kind, domain, title, started_at AS start, ended_at AS end FROM activity
       WHERE user_id = ? AND started_at >= ? AND started_at < ?
       ORDER BY started_at`
    )
    .all(userId, from, to) as ActivitySummary["timeline"];

  return {
    browseSeconds: byKind("browse"),
    idleSeconds: byKind("idle"),
    awaySeconds: byKind("away"),
    domains: domains.map((d) => ({ ...d, domain: d.domain || "(unknown)" })),
    pages,
    timeline,
    lastActivityAt: timeline.length ? timeline[timeline.length - 1].end : null,
  };
}

// ── Tracker keys ──
// The extension can't lean on the httpOnly session cookie, so each user gets
// one key to paste into it. Stored hashed, like session tokens; generating a
// new one revokes the old.

const hashKey = (key: string) => crypto.createHash("sha256").update(key).digest("hex");

export function createTrackerKey(userId: number): string {
  ensureWorkTables();
  const key = `mk_${crypto.randomBytes(24).toString("hex")}`;
  rawDb
    .prepare(
      `INSERT INTO tracker_keys (user_id, key_hash, created_at) VALUES (?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET key_hash = excluded.key_hash,
         created_at = excluded.created_at, last_used_at = NULL`
    )
    .run(userId, hashKey(key), nowIso());
  return key;
}

export function trackerKeyStatus(userId: number): { hasKey: boolean; lastUsedAt: string | null } {
  ensureWorkTables();
  const row = rawDb
    .prepare("SELECT last_used_at FROM tracker_keys WHERE user_id = ?")
    .get(userId) as { last_used_at: string | null } | undefined;
  return { hasKey: !!row, lastUsedAt: row?.last_used_at ?? null };
}

export function userIdForTrackerKey(key: string): number | null {
  ensureWorkTables();
  if (!key.startsWith("mk_")) return null;
  const row = rawDb
    .prepare("SELECT user_id FROM tracker_keys WHERE key_hash = ?")
    .get(hashKey(key)) as { user_id: number } | undefined;
  if (!row) return null;
  rawDb
    .prepare("UPDATE tracker_keys SET last_used_at = ? WHERE user_id = ?")
    .run(nowIso(), row.user_id);
  return row.user_id;
}
