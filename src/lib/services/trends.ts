import { rawDb } from "../db";
import { ensureAuthTables } from "./auth";

// The trend researcher's daily suggestions: one row per Instagram link put
// forward for a given day, either a reel or a carousel, with the models it
// suits, its niche and the case for why it'll go viral. A reviewer (owner,
// admin or CEO) approves or rejects each one; approved reels/carousels then
// feed the production board (services/production.ts).

export type TrendKind = "reel" | "carousel";
export type ReviewStatus = "pending" | "approved" | "rejected";

let ensured = false;
export function ensureTrendTables(): void {
  if (ensured) return;
  ensureAuthTables();
  rawDb.exec(`
    CREATE TABLE IF NOT EXISTS trend_suggestions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      kind TEXT NOT NULL,
      url TEXT NOT NULL,
      niche TEXT,
      models TEXT NOT NULL DEFAULT '[]',
      justification TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      review_note TEXT,
      reviewed_by INTEGER REFERENCES users(id),
      reviewed_at TEXT,
      created_by INTEGER NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS trend_suggestions_date ON trend_suggestions (date);
    CREATE TABLE IF NOT EXISTS trend_comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      trend_id INTEGER NOT NULL REFERENCES trend_suggestions(id),
      user_id INTEGER NOT NULL REFERENCES users(id),
      body TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS trend_comments_trend ON trend_comments (trend_id);
  `);
  ensured = true;
}

// The discussion under a trend: the reviewer's note when approving it, then
// anything the manager, CEO, researcher or creator adds while it's produced.
export interface TrendComment {
  id: number;
  trendId: number;
  authorId: number;
  author: string;
  body: string;
  createdAt: string;
}

export interface Trend {
  id: number;
  date: string;
  kind: TrendKind;
  url: string;
  niche: string | null;
  models: string[];
  justification: string;
  status: ReviewStatus;
  reviewNote: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  createdById: number;
  createdBy: string;
  createdAt: string;
  comments: TrendComment[];
}

interface TrendRow {
  id: number;
  date: string;
  kind: TrendKind;
  url: string;
  niche: string | null;
  models: string;
  justification: string;
  status: ReviewStatus;
  review_note: string | null;
  reviewer_name: string | null;
  reviewed_at: string | null;
  created_by: number;
  creator_name: string | null;
  created_at: string;
}

const SELECT = `
  SELECT t.*, c.name AS creator_name, r.name AS reviewer_name
  FROM trend_suggestions t
  LEFT JOIN users c ON c.id = t.created_by
  LEFT JOIN users r ON r.id = t.reviewed_by`;

interface CommentRow {
  id: number;
  trend_id: number;
  user_id: number;
  author_name: string | null;
  body: string;
  created_at: string;
}

// Every comment on these trends, oldest first, grouped by trend.
function commentsFor(trendIds: number[]): Map<number, TrendComment[]> {
  const out = new Map<number, TrendComment[]>();
  if (trendIds.length === 0) return out;
  const rows = rawDb
    .prepare(
      `SELECT c.*, u.name AS author_name FROM trend_comments c
       LEFT JOIN users u ON u.id = c.user_id
       WHERE c.trend_id IN (${trendIds.map(() => "?").join(",")})
       ORDER BY c.created_at, c.id`
    )
    .all(...trendIds) as CommentRow[];
  for (const r of rows) {
    const list = out.get(r.trend_id) ?? [];
    list.push({
      id: r.id,
      trendId: r.trend_id,
      authorId: r.user_id,
      author: r.author_name || "(deleted user)",
      body: r.body,
      createdAt: r.created_at,
    });
    out.set(r.trend_id, list);
  }
  return out;
}

function toTrends(rows: TrendRow[]): Trend[] {
  const comments = commentsFor(rows.map((r) => r.id));
  return rows.map((r) => toTrend(r, comments.get(r.id) ?? []));
}

function toTrend(r: TrendRow, comments: TrendComment[]): Trend {
  return {
    id: r.id,
    date: r.date,
    kind: r.kind,
    url: r.url,
    niche: r.niche,
    models: JSON.parse(r.models || "[]"),
    justification: r.justification,
    status: r.status,
    reviewNote: r.review_note,
    reviewedBy: r.reviewer_name,
    reviewedAt: r.reviewed_at,
    createdById: r.created_by,
    createdBy: r.creator_name || "(deleted user)",
    createdAt: r.created_at,
    comments,
  };
}

export const isDate = (v: unknown): v is string =>
  typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);

export function listTrends(filter: {
  date?: string;
  from?: string;
  to?: string;
  status?: ReviewStatus;
  createdBy?: number;
}): Trend[] {
  ensureTrendTables();
  const where: string[] = [];
  const args: unknown[] = [];
  const add = (clause: string, value: unknown) => {
    where.push(clause);
    args.push(value);
  };
  if (filter.date) add("t.date = ?", filter.date);
  if (filter.from) add("t.date >= ?", filter.from);
  if (filter.to) add("t.date <= ?", filter.to);
  if (filter.status) add("t.status = ?", filter.status);
  if (filter.createdBy) add("t.created_by = ?", filter.createdBy);
  const rows = rawDb
    .prepare(
      `${SELECT} ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
       ORDER BY t.date DESC, t.id DESC`
    )
    .all(...args) as TrendRow[];
  return toTrends(rows);
}

export function getTrend(id: number): Trend | null {
  ensureTrendTables();
  const row = rawDb.prepare(`${SELECT} WHERE t.id = ?`).get(id) as TrendRow | undefined;
  return row ? toTrends([row])[0] : null;
}

// Per-day counts for the calendar strip.
export function trendCountsByDate(
  from: string,
  to: string,
  createdBy?: number
): Array<{ date: string; total: number; approved: number; pending: number }> {
  ensureTrendTables();
  return rawDb
    .prepare(
      `SELECT date, COUNT(*) AS total,
         SUM(status = 'approved') AS approved,
         SUM(status = 'pending') AS pending
       FROM trend_suggestions
       WHERE date >= ? AND date <= ? ${createdBy ? "AND created_by = ?" : ""}
       GROUP BY date`
    )
    .all(...(createdBy ? [from, to, createdBy] : [from, to])) as Array<{
    date: string;
    total: number;
    approved: number;
    pending: number;
  }>;
}

export interface TrendInput {
  date: string;
  kind: TrendKind;
  url: string;
  niche?: string | null;
  models: string[];
  justification: string;
}

export function validateTrendInput(input: Partial<TrendInput>): string | null {
  if (!isDate(input.date)) return "Pick a date";
  if (input.kind !== "reel" && input.kind !== "carousel") return "Pick reel or carousel";
  if (!input.url?.trim()) return "Paste the Instagram link";
  try {
    new URL(input.url.trim());
  } catch {
    return "That link isn't a valid URL";
  }
  if (!Array.isArray(input.models) || input.models.length === 0) {
    return "Assign at least one model";
  }
  if (!input.justification?.trim()) return "Say why you think it'll go viral";
  return null;
}

export function createTrend(input: TrendInput, userId: number): Trend {
  ensureTrendTables();
  const info = rawDb
    .prepare(
      `INSERT INTO trend_suggestions (date, kind, url, niche, models, justification, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      input.date,
      input.kind,
      input.url.trim(),
      input.niche?.trim() || null,
      JSON.stringify([...new Set(input.models.map((m) => m.trim()).filter(Boolean))]),
      input.justification.trim(),
      userId,
      new Date().toISOString()
    );
  return getTrend(Number(info.lastInsertRowid))!;
}

// Editing resets a rejected suggestion back to pending — the researcher has
// addressed the note, so it goes back in front of the reviewer.
export function updateTrend(id: number, input: TrendInput): Trend | null {
  ensureTrendTables();
  rawDb
    .prepare(
      `UPDATE trend_suggestions SET date = ?, kind = ?, url = ?, niche = ?, models = ?,
         justification = ?, status = 'pending', review_note = NULL, reviewed_by = NULL, reviewed_at = NULL
       WHERE id = ?`
    )
    .run(
      input.date,
      input.kind,
      input.url.trim(),
      input.niche?.trim() || null,
      JSON.stringify([...new Set(input.models.map((m) => m.trim()).filter(Boolean))]),
      input.justification.trim(),
      id
    );
  return getTrend(id);
}

export function reviewTrend(
  id: number,
  status: ReviewStatus,
  note: string | null,
  reviewerId: number
): Trend | null {
  ensureTrendTables();
  if (status === "pending") {
    rawDb
      .prepare(
        "UPDATE trend_suggestions SET status = 'pending', review_note = NULL, reviewed_by = NULL, reviewed_at = NULL WHERE id = ?"
      )
      .run(id);
  } else {
    rawDb
      .prepare(
        "UPDATE trend_suggestions SET status = ?, review_note = ?, reviewed_by = ?, reviewed_at = ? WHERE id = ?"
      )
      .run(status, note?.trim() || null, reviewerId, new Date().toISOString(), id);
  }
  return getTrend(id);
}

export function deleteTrend(id: number): void {
  ensureTrendTables();
  rawDb.transaction(() => {
    rawDb.prepare("DELETE FROM trend_comments WHERE trend_id = ?").run(id);
    rawDb.prepare("DELETE FROM trend_suggestions WHERE id = ?").run(id);
  })();
}

export function getTrendComment(id: number): TrendComment | null {
  ensureTrendTables();
  const row = rawDb.prepare("SELECT trend_id FROM trend_comments WHERE id = ?").get(id) as
    | { trend_id: number }
    | undefined;
  if (!row) return null;
  return commentsFor([row.trend_id]).get(row.trend_id)?.find((c) => c.id === id) ?? null;
}

export function addTrendComment(trendId: number, userId: number, body: string): TrendComment {
  ensureTrendTables();
  const info = rawDb
    .prepare("INSERT INTO trend_comments (trend_id, user_id, body, created_at) VALUES (?, ?, ?, ?)")
    .run(trendId, userId, body.trim(), new Date().toISOString());
  return getTrendComment(Number(info.lastInsertRowid))!;
}

export function deleteTrendComment(id: number): void {
  ensureTrendTables();
  rawDb.prepare("DELETE FROM trend_comments WHERE id = ?").run(id);
}
