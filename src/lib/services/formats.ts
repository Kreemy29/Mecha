import { rawDb } from "../db";
import { ensureInstagramTables } from "./instagram";

// Runtime table creation, same pattern as instagram.ts/higgsfield.ts: no
// migration step, so a fresh SQLite file (or an existing one that predates
// this feature) gets everything it needs at the module's entry point.
let tablesEnsured = false;
export function ensureFormatTables(): void {
  if (tablesEnsured) return;
  // winning_formats must already exist before the ALTERs below can touch it.
  ensureInstagramTables();

  rawDb.exec(`
    CREATE TABLE IF NOT EXISTS format_weeks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      label TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS format_assignments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      format_id INTEGER NOT NULL REFERENCES winning_formats(id),
      model TEXT NOT NULL,
      quota INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS format_assignments_format
      ON format_assignments (format_id);
    CREATE TABLE IF NOT EXISTS format_comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      format_id INTEGER NOT NULL REFERENCES winning_formats(id),
      author TEXT NOT NULL,
      body TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS format_comments_format
      ON format_comments (format_id);
  `);

  // winning_formats predates the weekly board — add the two columns it needs
  // if this is an existing database.
  const columns = rawDb
    .prepare("PRAGMA table_info(winning_formats)")
    .all() as Array<{ name: string }>;
  const have = new Set(columns.map((c) => c.name));
  if (!have.has("week_id")) {
    rawDb.exec(
      "ALTER TABLE winning_formats ADD COLUMN week_id INTEGER REFERENCES format_weeks(id)"
    );
  }
  if (!have.has("method_generation_id")) {
    rawDb.exec("ALTER TABLE winning_formats ADD COLUMN method_generation_id TEXT");
  }

  tablesEnsured = true;
}
