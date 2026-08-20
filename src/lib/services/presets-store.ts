import fs from "fs";
import path from "path";
import { db, rawDb, schema } from "@/lib/db";

// Storage for the two hand-authored preset kinds added alongside backgrounds:
//   • prompt presets — proven recreation prompts + their video/thumbnail
//   • style presets  — reusable hairstyle / makeup options
//
// Same two defences the backgrounds table needed (HANDOFF §8.3):
//   1. tables are created at runtime, so adding them never requires `db:push`
//   2. every write mirrors to a JSON file in the repo, restored when the table
//      comes up empty — so a schema push or DB reset can't destroy them.

const PROMPT_BACKUP = path.resolve("./prompt-presets.seed.json");
const STYLE_BACKUP = path.resolve("./style-presets.seed.json");

let ensured = false;
export function ensurePresetTables(): void {
  if (ensured) return;
  rawDb.exec(`
    CREATE TABLE IF NOT EXISTS prompt_presets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      prompt TEXT NOT NULL,
      thumb_path TEXT,
      video_path TEXT,
      duration_seconds REAL,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS style_presets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kind TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      is_default INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  ensured = true;
}

function writeBackup(file: string, rows: unknown[]): void {
  try {
    fs.writeFileSync(file, JSON.stringify(rows, null, 2));
  } catch (err) {
    console.error(`[presets] backup failed (${path.basename(file)}):`, err);
  }
}

export function backupPromptPresets(): void {
  ensurePresetTables();
  writeBackup(PROMPT_BACKUP, db.select().from(schema.promptPresets).all());
}

export function backupStylePresets(): void {
  ensurePresetTables();
  writeBackup(STYLE_BACKUP, db.select().from(schema.stylePresets).all());
}

// Re-insert from the JSON mirror when the table is empty. Safe on every read.
export function restorePromptPresetsIfEmpty(): void {
  try {
    ensurePresetTables();
    if (db.select().from(schema.promptPresets).all().length > 0) return;
    if (!fs.existsSync(PROMPT_BACKUP)) return;
    const rows = JSON.parse(fs.readFileSync(PROMPT_BACKUP, "utf-8"));
    if (!Array.isArray(rows)) return;
    for (const r of rows) {
      if (!r?.name || !r?.prompt) continue;
      db.insert(schema.promptPresets)
        .values({
          name: r.name,
          prompt: r.prompt,
          thumbPath: r.thumbPath ?? null,
          videoPath: r.videoPath ?? null,
          durationSeconds: r.durationSeconds ?? null,
          notes: r.notes ?? null,
        })
        .run();
    }
    console.log(`[presets] restored ${rows.length} prompt preset(s)`);
  } catch (err) {
    console.error("[presets] prompt restore failed:", err);
  }
}

export function restoreStylePresetsIfEmpty(): void {
  try {
    ensurePresetTables();
    if (db.select().from(schema.stylePresets).all().length > 0) return;
    if (!fs.existsSync(STYLE_BACKUP)) return;
    const rows = JSON.parse(fs.readFileSync(STYLE_BACKUP, "utf-8"));
    if (!Array.isArray(rows)) return;
    for (const r of rows) {
      if (!r?.name || !r?.description) continue;
      if (!["hair", "makeup", "outfit"].includes(r.kind)) continue;
      db.insert(schema.stylePresets)
        .values({
          kind: r.kind,
          name: r.name,
          description: r.description,
          isDefault: !!r.isDefault,
        })
        .run();
    }
    console.log(`[presets] restored ${rows.length} style preset(s)`);
  } catch (err) {
    console.error("[presets] style restore failed:", err);
  }
}
