import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema";
import path from "path";
import fs from "fs";

const dbPath = process.env.DATABASE_PATH || "./data/mecha.db";
const resolvedPath = path.resolve(dbPath);
const dir = path.dirname(resolvedPath);

if (!fs.existsSync(dir)) {
  fs.mkdirSync(dir, { recursive: true });
}

const sqlite = new Database(resolvedPath);

// `next build` evaluates this module in dozens of workers at once (47 on
// Render), all opening the same file. Switching to WAL and the CREATE TABLEs
// below both need a write lock, so:
//  - busy_timeout goes FIRST, or a colliding worker fails instantly with
//    SQLITE_BUSY ("database is locked") instead of waiting;
//  - the schema runs in an IMMEDIATE transaction: a plain CREATE ... IF NOT
//    EXISTS starts as a read and upgrades, and SQLite skips the busy handler
//    for that upgrade;
//  - both are retried, which also covers SQLITE_IOERR_TRUNCATE, a Windows
//    quirk when several processes create a brand-new file together.
sqlite.pragma("busy_timeout = 15000");

const pause = new Int32Array(new SharedArrayBuffer(4));
function withRetry<T>(fn: () => T): T {
  for (let attempt = 0; ; attempt++) {
    try {
      return fn();
    } catch (err) {
      const code = (err as { code?: string }).code ?? "";
      const transient = code.startsWith("SQLITE_BUSY") || code === "SQLITE_IOERR_TRUNCATE";
      if (!transient || attempt >= 50) throw err;
      Atomics.wait(pause, 0, 0, 50 + Math.random() * 150);
    }
  }
}

withRetry(() => sqlite.pragma("journal_mode = WAL"));

// These predate the ensure*Tables() pattern used by auth.ts / instagram.ts /
// presets-store.ts for tables added later. They only ever existed because
// `npm run db:push` was run once against the dev machine's file — a fresh
// SQLite file (e.g. a first boot on Render) has none of them. Create them
// here, at the module's single entry point, so both the web process and the
// worker process have them before either runs a query.
const CORE_SCHEMA = `
  CREATE TABLE IF NOT EXISTS characters (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    feature_profile TEXT NOT NULL,
    higgsfield_character_ref TEXT,
    base_image_path TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS presets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT,
    type TEXT NOT NULL,
    search_prompt_seed TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS batches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL,
    character_id INTEGER REFERENCES characters(id),
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS "references" (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    batch_id INTEGER REFERENCES batches(id),
    source_url TEXT,
    source_kind TEXT,
    local_path TEXT,
    frame_path TEXT,
    selected INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    batch_id INTEGER REFERENCES batches(id),
    character_id INTEGER REFERENCES characters(id),
    reference_id INTEGER REFERENCES "references"(id),
    kind TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'queued',
    provider TEXT,
    provider_model TEXT,
    provider_params TEXT,
    provider_job_id TEXT,
    prompt TEXT,
    prompt_history TEXT,
    attempts INTEGER NOT NULL DEFAULT 0,
    output_path TEXT,
    error TEXT,
    cost_estimate REAL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS backgrounds (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    image_path TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`;
withRetry(() => sqlite.transaction(() => sqlite.exec(CORE_SCHEMA)).immediate());

export const db = drizzle(sqlite, { schema });
export { schema };
// Raw handle for the rare cases that need direct SQL (e.g. CREATE TABLE IF
// NOT EXISTS at runtime, avoiding a data-destructive `db:push`).
export const rawDb = sqlite;
