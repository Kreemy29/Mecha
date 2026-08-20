import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { and, desc, eq, ne } from "drizzle-orm";
import {
  backupStylePresets,
  ensurePresetTables,
  restoreStylePresetsIfEmpty,
} from "@/lib/services/presets-store";

const KINDS = ["hair", "makeup", "outfit"] as const;
type Kind = (typeof KINDS)[number];
const isKind = (v: unknown): v is Kind =>
  typeof v === "string" && (KINDS as readonly string[]).includes(v);

// Reusable hair / makeup / outfit options. Hair and makeup are single-valued
// and one of each can be flagged default (preselected by the Seedance style
// step); outfits are a library you pick several from.
export async function GET(request: NextRequest) {
  restoreStylePresetsIfEmpty();
  const kind = request.nextUrl.searchParams.get("kind");
  const q = db.select().from(schema.stylePresets);
  const rows = isKind(kind)
    ? q
        .where(eq(schema.stylePresets.kind, kind))
        .orderBy(desc(schema.stylePresets.createdAt))
        .all()
    : q.orderBy(desc(schema.stylePresets.createdAt)).all();
  return NextResponse.json(rows);
}

export async function POST(request: NextRequest) {
  try {
    ensurePresetTables();
    const { kind, name, description, isDefault } = await request.json();
    if (!isKind(kind)) {
      return NextResponse.json(
        { error: `kind must be ${KINDS.join("|")}` },
        { status: 400 }
      );
    }
    if (!name?.trim() || !description?.trim()) {
      return NextResponse.json(
        { error: "name and description are required" },
        { status: 400 }
      );
    }

    // Outfits are picked several at a time, so "the default one" is meaningless.
    const wantsDefault = kind !== "outfit" && !!isDefault;

    const row = db
      .insert(schema.stylePresets)
      .values({
        kind,
        name: name.trim(),
        description: description.trim(),
        isDefault: wantsDefault,
      })
      .returning()
      .get();

    // Only one default per kind.
    if (row.isDefault) {
      db.update(schema.stylePresets)
        .set({ isDefault: false })
        .where(
          and(
            eq(schema.stylePresets.kind, kind),
            ne(schema.stylePresets.id, row.id)
          )
        )
        .run();
    }

    backupStylePresets();
    return NextResponse.json(row, { status: 201 });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// Flip which option is the default for its kind.
export async function PATCH(request: NextRequest) {
  ensurePresetTables();
  const { id, isDefault } = await request.json();
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  const target = db
    .select()
    .from(schema.stylePresets)
    .where(eq(schema.stylePresets.id, id))
    .get();
  if (!target) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (isDefault) {
    db.update(schema.stylePresets)
      .set({ isDefault: false })
      .where(eq(schema.stylePresets.kind, target.kind))
      .run();
  }
  const row = db
    .update(schema.stylePresets)
    .set({ isDefault: !!isDefault })
    .where(eq(schema.stylePresets.id, id))
    .returning()
    .get();
  backupStylePresets();
  return NextResponse.json(row);
}

export async function DELETE(request: NextRequest) {
  ensurePresetTables();
  const id = parseInt(request.nextUrl.searchParams.get("id") || "");
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });
  db.delete(schema.stylePresets).where(eq(schema.stylePresets.id, id)).run();
  backupStylePresets();
  return NextResponse.json({ ok: true });
}
