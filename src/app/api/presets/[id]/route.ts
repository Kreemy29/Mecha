import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { eq } from "drizzle-orm";

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await request.json();
  const { name, description, type, searchPromptSeed, active } = body;

  const result = db
    .update(schema.presets)
    .set({
      ...(name !== undefined && { name }),
      ...(description !== undefined && { description }),
      ...(type !== undefined && { type }),
      ...(searchPromptSeed !== undefined && { searchPromptSeed }),
      ...(active !== undefined && { active }),
    })
    .where(eq(schema.presets.id, parseInt(id)))
    .returning()
    .get();

  if (!result) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json(result);
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  db.delete(schema.presets)
    .where(eq(schema.presets.id, parseInt(id)))
    .run();
  return NextResponse.json({ ok: true });
}
