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
// A break gets no heartbeats (people walk away), so it's judged on its own
// clock: one left running this long is treated as the end of the day, and
// the session is closed at the moment the break began.
const BREAK_STALE_MS = 4 * 60 * 60 * 1000;
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
    CREATE TABLE IF NOT EXISTS work_breaks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER NOT NULL REFERENCES work_sessions(id),
      started_at TEXT NOT NULL,
      ended_at TEXT
    );
    CREATE INDEX IF NOT EXISTS work_breaks_session ON work_breaks (session_id);
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
    CREATE TABLE IF NOT EXISTS tracking_consent (
      user_id INTEGER PRIMARY KEY REFERENCES users(id),
      version INTEGER NOT NULL,
      accepted_at TEXT,
      revoked_at TEXT
    );
  `);
  // activity predates the desktop tracker: add where a row came from and, for
  // desktop rows, the program's name.
  const cols = new Set(
    (rawDb.prepare("PRAGMA table_info(activity)").all() as Array<{ name: string }>).map((c) => c.name)
  );
  if (!cols.has("app")) rawDb.exec("ALTER TABLE activity ADD COLUMN app TEXT");
  if (!cols.has("source")) rawDb.exec("ALTER TABLE activity ADD COLUMN source TEXT NOT NULL DEFAULT 'chrome'");
  ensured = true;
}

// ── Consent ──
// Nothing is recorded for someone who hasn't agreed to the current version
// of lib/tracking-consent.ts. Withdrawing stops recording immediately; what
// was already recorded stays (it's part of their timesheet).

export interface ConsentStatus {
  accepted: boolean;
  version: number | null;
  acceptedAt: string | null;
  revokedAt: string | null;
}

export function consentStatus(userId: number, currentVersion: number): ConsentStatus {
  ensureWorkTables();
  const row = rawDb
    .prepare("SELECT version, accepted_at, revoked_at FROM tracking_consent WHERE user_id = ?")
    .get(userId) as { version: number; accepted_at: string | null; revoked_at: string | null } | undefined;
  return {
    accepted: !!row && !!row.accepted_at && !row.revoked_at && row.version >= currentVersion,
    version: row?.version ?? null,
    acceptedAt: row?.accepted_at ?? null,
    revokedAt: row?.revoked_at ?? null,
  };
}

export function setConsent(userId: number, version: number, accepted: boolean): void {
  ensureWorkTables();
  const now = nowIso();
  if (accepted) {
    rawDb
      .prepare(
        `INSERT INTO tracking_consent (user_id, version, accepted_at, revoked_at) VALUES (?, ?, ?, NULL)
         ON CONFLICT(user_id) DO UPDATE SET version = excluded.version, accepted_at = excluded.accepted_at, revoked_at = NULL`
      )
      .run(userId, version, now);
  } else {
    rawDb
      .prepare(
        `INSERT INTO tracking_consent (user_id, version, accepted_at, revoked_at) VALUES (?, ?, NULL, ?)
         ON CONFLICT(user_id) DO UPDATE SET revoked_at = excluded.revoked_at`
      )
      .run(userId, version, now);
  }
}

export interface WorkBreak {
  id: number;
  start: string;
  end: string | null;
}

export interface WorkSession {
  id: number;
  userId: number;
  clockIn: string;
  clockOut: string | null;
  lastSeen: string;
  autoClosed: boolean;
  breaks: WorkBreak[];
  // An open break on an open session.
  onBreak: boolean;
}

interface WorkSessionRow {
  id: number;
  user_id: number;
  clock_in: string;
  clock_out: string | null;
  last_seen: string;
  auto_closed: number;
}

interface WorkBreakRow {
  id: number;
  session_id: number;
  started_at: string;
  ended_at: string | null;
}

const nowIso = () => new Date().toISOString();

function breaksFor(sessionIds: number[]): Map<number, WorkBreak[]> {
  const out = new Map<number, WorkBreak[]>();
  if (sessionIds.length === 0) return out;
  const rows = rawDb
    .prepare(
      `SELECT * FROM work_breaks WHERE session_id IN (${sessionIds.map(() => "?").join(",")})
       ORDER BY started_at`
    )
    .all(...sessionIds) as WorkBreakRow[];
  for (const r of rows) {
    const list = out.get(r.session_id) ?? [];
    list.push({ id: r.id, start: r.started_at, end: r.ended_at });
    out.set(r.session_id, list);
  }
  return out;
}

function toSession(r: WorkSessionRow, breaks: WorkBreak[]): WorkSession {
  return {
    id: r.id,
    userId: r.user_id,
    clockIn: r.clock_in,
    clockOut: r.clock_out,
    lastSeen: r.last_seen,
    autoClosed: !!r.auto_closed,
    breaks,
    onBreak: !r.clock_out && breaks.some((b) => !b.end),
  };
}

// The user's open session, if any — closing it first if it has gone stale.
export function openSession(userId: number): WorkSession | null {
  ensureWorkTables();
  const row = rawDb
    .prepare(
      "SELECT * FROM work_sessions WHERE user_id = ? AND clock_out IS NULL ORDER BY id DESC LIMIT 1"
    )
    .get(userId) as WorkSessionRow | undefined;
  if (!row) return null;
  const breaks = breaksFor([row.id]).get(row.id) ?? [];
  const openBreak = breaks.find((b) => !b.end);

  if (openBreak) {
    // On break: no heartbeats expected, so only a very long break counts as
    // walking off for the day. Worked time stops where the break began.
    if (Date.now() - Date.parse(openBreak.start) > BREAK_STALE_MS) {
      rawDb.transaction(() => {
        rawDb.prepare("UPDATE work_breaks SET ended_at = started_at WHERE id = ?").run(openBreak.id);
        rawDb
          .prepare("UPDATE work_sessions SET clock_out = ?, auto_closed = 1 WHERE id = ?")
          .run(openBreak.start, row.id);
      })();
      return null;
    }
  } else if (Date.now() - Date.parse(row.last_seen) > STALE_MS) {
    rawDb
      .prepare("UPDATE work_sessions SET clock_out = last_seen, auto_closed = 1 WHERE id = ?")
      .run(row.id);
    return null;
  }
  return toSession(row, breaks);
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
    breaks: [],
    onBreak: false,
  };
}

export function clockOut(userId: number): void {
  const open = openSession(userId);
  if (!open) return;
  const now = nowIso();
  rawDb.transaction(() => {
    // Clocking out from a break ends the break there too.
    rawDb
      .prepare("UPDATE work_breaks SET ended_at = ? WHERE session_id = ? AND ended_at IS NULL")
      .run(now, open.id);
    rawDb
      .prepare("UPDATE work_sessions SET clock_out = ?, last_seen = ? WHERE id = ?")
      .run(now, now, open.id);
  })();
}

export function startBreak(userId: number): WorkSession | null {
  const open = openSession(userId);
  if (!open || open.onBreak) return open;
  const now = nowIso();
  rawDb.transaction(() => {
    rawDb.prepare("INSERT INTO work_breaks (session_id, started_at) VALUES (?, ?)").run(open.id, now);
    rawDb.prepare("UPDATE work_sessions SET last_seen = ? WHERE id = ?").run(now, open.id);
  })();
  return openSession(userId);
}

export function endBreak(userId: number): WorkSession | null {
  const open = openSession(userId);
  if (!open || !open.onBreak) return open;
  const now = nowIso();
  rawDb.transaction(() => {
    rawDb
      .prepare("UPDATE work_breaks SET ended_at = ? WHERE session_id = ? AND ended_at IS NULL")
      .run(now, open.id);
    rawDb.prepare("UPDATE work_sessions SET last_seen = ? WHERE id = ?").run(now, open.id);
  })();
  return openSession(userId);
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
  const breaks = breaksFor(rows.map((r) => r.id));
  return rows.map((r) => toSession(r, breaks.get(r.id) ?? []));
}

// Where a session's clock currently stands: its clock-out, or — while open —
// "now" during a break (the break itself is subtracted) and the last
// heartbeat otherwise, so a stale-but-not-yet-closed session doesn't inflate.
function effectiveEnd(s: WorkSession): number {
  if (s.clockOut) return Date.parse(s.clockOut);
  return s.onBreak ? Date.now() : Date.parse(s.lastSeen);
}

const overlap = (a0: number, a1: number, b0: number, b1: number) =>
  Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));

// Break seconds of a session inside [from, to).
export function breakSecondsWithin(s: WorkSession, from: string, to: string): number {
  const f = Date.parse(from);
  const t = Date.parse(to);
  const end = effectiveEnd(s);
  const ms = s.breaks.reduce(
    (sum, b) => sum + overlap(Date.parse(b.start), b.end ? Date.parse(b.end) : end, f, t),
    0
  );
  return Math.round(ms / 1000);
}

// WORKED seconds of a session inside [from, to): its span minus its breaks.
export function secondsWithin(s: WorkSession, from: string, to: string): number {
  const gross = overlap(Date.parse(s.clockIn), effectiveEnd(s), Date.parse(from), Date.parse(to));
  return Math.max(0, Math.round(gross / 1000) - breakSecondsWithin(s, from, to));
}

// ── Activity (from the Chrome tracker) ──

// browse: a Chrome tab (extension) · app: a desktop program (desktop tracker)
// idle / away: no input, or not at this browser/computer.
export type ActivityKind = "browse" | "app" | "idle" | "away";
export type ActivitySource = "chrome" | "desktop";

export interface ActivitySegment {
  kind: ActivityKind;
  url?: string;
  // Desktop only: the program, e.g. "CapCut".
  app?: string;
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
// were kept. Everything is dropped without consent (see consentStatus), when
// clocked out, or on a break.
export function recordActivity(
  userId: number,
  segments: ActivitySegment[],
  source: ActivitySource,
  consentVersion: number
): number {
  if (!consentStatus(userId, consentVersion).accepted) return 0;
  // A break is private: nothing from the trackers is kept while one is running.
  const current = openSession(userId);
  if (!current || current.onBreak) return 0;
  const open = heartbeat(userId);
  if (!open) return 0;
  const insert = rawDb.prepare(
    `INSERT INTO activity (user_id, session_id, kind, domain, url, title, app, source, started_at, ended_at, seconds)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  // Each tracker may only report its own kind of activity.
  const allowed: ActivityKind[] = source === "desktop" ? ["app", "idle", "away"] : ["browse", "idle", "away"];
  let kept = 0;
  const tx = rawDb.transaction((list: ActivitySegment[]) => {
    for (const seg of list) {
      if (!allowed.includes(seg.kind)) continue;
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
        seg.kind === "browse" || seg.kind === "app" ? (seg.title || "").slice(0, 300) : null,
        seg.kind === "app" ? (seg.app || "Unknown app").slice(0, 120) : null,
        source,
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
  appSeconds: number;
  idleSeconds: number;
  awaySeconds: number;
  // True when the desktop tracker reported in this range.
  hasDesktop: boolean;
  domains: Array<{ domain: string; seconds: number }>;
  pages: Array<{ url: string; title: string; seconds: number }>;
  apps: Array<{ app: string; seconds: number }>;
  windows: Array<{ app: string; title: string; seconds: number }>;
  timeline: Array<{
    kind: ActivityKind;
    domain: string | null;
    app: string | null;
    title: string | null;
    start: string;
    end: string;
  }>;
  lastActivityAt: string | null;
}

export function activitySummary(userId: number, from: string, to: string): ActivitySummary {
  ensureWorkTables();
  const hasDesktop = !!rawDb
    .prepare(
      `SELECT 1 FROM activity WHERE user_id = ? AND source = 'desktop' AND started_at >= ? AND started_at < ? LIMIT 1`
    )
    .get(userId, from, to);
  // Both trackers report idle/away. With the desktop tracker running, its
  // view is the true one ("away from Chrome" isn't away from work), so the
  // Chrome extension's idle/away rows are left out rather than double-counted.
  const idleSource = hasDesktop ? "desktop" : "chrome";

  const kinds = rawDb
    .prepare(
      `SELECT kind, SUM(seconds) AS s FROM activity
       WHERE user_id = ? AND started_at >= ? AND started_at < ?
         AND (kind IN ('browse', 'app') OR source = ?)
       GROUP BY kind`
    )
    .all(userId, from, to, idleSource) as Array<{ kind: ActivityKind; s: number }>;
  const byKind = (k: ActivityKind) => kinds.find((r) => r.kind === k)?.s ?? 0;

  const apps = rawDb
    .prepare(
      `SELECT app, SUM(seconds) AS seconds FROM activity
       WHERE user_id = ? AND kind = 'app' AND started_at >= ? AND started_at < ?
       GROUP BY app ORDER BY seconds DESC LIMIT 20`
    )
    .all(userId, from, to) as Array<{ app: string; seconds: number }>;

  const windows = rawDb
    .prepare(
      `SELECT app, title, SUM(seconds) AS seconds FROM activity
       WHERE user_id = ? AND kind = 'app' AND started_at >= ? AND started_at < ?
       GROUP BY app, title ORDER BY seconds DESC LIMIT 25`
    )
    .all(userId, from, to) as Array<{ app: string; title: string; seconds: number }>;

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
      `SELECT kind, domain, app, title, started_at AS start, ended_at AS end FROM activity
       WHERE user_id = ? AND started_at >= ? AND started_at < ?
         AND (kind IN ('browse', 'app') OR source = ?)
       ORDER BY started_at`
    )
    .all(userId, from, to, idleSource) as ActivitySummary["timeline"];

  return {
    browseSeconds: byKind("browse"),
    appSeconds: byKind("app"),
    idleSeconds: byKind("idle"),
    awaySeconds: byKind("away"),
    hasDesktop,
    domains: domains.map((d) => ({ ...d, domain: d.domain || "(unknown)" })),
    pages,
    apps: apps.map((a) => ({ ...a, app: a.app || "Unknown app" })),
    windows,
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
