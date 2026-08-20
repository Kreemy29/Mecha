import fs from "fs";
import path from "path";
import { db, schema } from "@/lib/db";

// Saved backgrounds are hand-authored data with no other source, and `db:push`
// drops/recreates tables (wiping them). We mirror the table to a JSON file in
// the repo on every write, and restore from it whenever the table is empty —
// so the presets survive schema pushes and DB resets.
// Repo root (NOT data/, which is gitignored) so the presets survive db:push
// AND travel with the repo / a fresh clone.
const BACKUP_PATH = path.resolve("./backgrounds.seed.json");

interface BackgroundRow {
  id: number;
  name: string;
  description: string;
  imagePath: string | null;
  createdAt?: string;
}

// Write the current table to disk (called after any create/delete).
export function backupBackgrounds(): void {
  try {
    const rows = db.select().from(schema.backgrounds).all();
    fs.mkdirSync(path.dirname(BACKUP_PATH), { recursive: true });
    fs.writeFileSync(BACKUP_PATH, JSON.stringify(rows, null, 2));
  } catch (err) {
    console.error("[backgrounds] backup failed:", err);
  }
}

// If the table is empty but a backup exists, re-insert the saved rows. Safe to
// call on every read — it no-ops once the table has data.
export function restoreBackgroundsIfEmpty(): void {
  try {
    const count = db.select().from(schema.backgrounds).all().length;
    if (count > 0) return;
    if (!fs.existsSync(BACKUP_PATH)) return;

    const rows = JSON.parse(
      fs.readFileSync(BACKUP_PATH, "utf-8")
    ) as BackgroundRow[];
    if (!Array.isArray(rows) || rows.length === 0) return;

    for (const r of rows) {
      if (!r?.name || !r?.description) continue;
      db.insert(schema.backgrounds)
        .values({ name: r.name, description: r.description, imagePath: r.imagePath ?? null })
        .run();
    }
    console.log(`[backgrounds] restored ${rows.length} preset(s) from backup`);
  } catch (err) {
    console.error("[backgrounds] restore failed:", err);
  }
}
