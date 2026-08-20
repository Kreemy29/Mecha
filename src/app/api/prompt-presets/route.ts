import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { db, schema } from "@/lib/db";
import { desc, eq } from "drizzle-orm";
import {
  backupPromptPresets,
  ensurePresetTables,
  restorePromptPresetsIfEmpty,
} from "@/lib/services/presets-store";

const PRESET_DIR = path.resolve("./storage/prompt-presets");

// Saved recreation prompts — a proven prompt plus the frame it was written
// from, reusable with only the outfit / hair / makeup swapped.
export async function GET() {
  restorePromptPresetsIfEmpty();
  const rows = db
    .select()
    .from(schema.promptPresets)
    .orderBy(desc(schema.promptPresets.createdAt))
    .all();
  return NextResponse.json(rows);
}

export async function POST(request: NextRequest) {
  try {
    ensurePresetTables();
    const { name, prompt, thumbPath, videoPath, durationSeconds, notes } =
      await request.json();
    if (!name?.trim() || !prompt?.trim()) {
      return NextResponse.json(
        { error: "name and prompt are required" },
        { status: 400 }
      );
    }

    // Copy the thumbnail out of storage/references — those frames get
    // overwritten as new videos are processed, and a preset must keep its
    // picture for good.
    let savedThumb: string | null = null;
    if (thumbPath) {
      try {
        const src = path.resolve(thumbPath);
        if (fs.existsSync(src)) {
          fs.mkdirSync(PRESET_DIR, { recursive: true });
          const dest = path.join(
            PRESET_DIR,
            `${Date.now()}_${path.basename(src)}`
          );
          fs.copyFileSync(src, dest);
          savedThumb = path.relative(process.cwd(), dest);
        }
      } catch (err) {
        console.error("[prompt-presets] thumbnail copy failed:", err);
      }
    }

    const row = db
      .insert(schema.promptPresets)
      .values({
        name: name.trim(),
        prompt: prompt.trim(),
        thumbPath: savedThumb,
        videoPath: videoPath || null,
        durationSeconds: durationSeconds ?? null,
        notes: notes?.trim() || null,
      })
      .returning()
      .get();
    backupPromptPresets();
    return NextResponse.json(row, { status: 201 });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  ensurePresetTables();
  const { id, name, prompt, notes } = await request.json();
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });
  const row = db
    .update(schema.promptPresets)
    .set({
      ...(name !== undefined && { name: String(name).trim() }),
      ...(prompt !== undefined && { prompt: String(prompt) }),
      ...(notes !== undefined && { notes: String(notes).trim() || null }),
    })
    .where(eq(schema.promptPresets.id, id))
    .returning()
    .get();
  backupPromptPresets();
  return NextResponse.json(row);
}

export async function DELETE(request: NextRequest) {
  ensurePresetTables();
  const id = parseInt(request.nextUrl.searchParams.get("id") || "");
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });
  db.delete(schema.promptPresets).where(eq(schema.promptPresets.id, id)).run();
  backupPromptPresets();
  return NextResponse.json({ ok: true });
}
