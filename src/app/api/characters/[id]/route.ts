import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { eq } from "drizzle-orm";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const character = db
    .select()
    .from(schema.characters)
    .where(eq(schema.characters.id, parseInt(id)))
    .get();

  if (!character) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json(character);
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await request.json();
  const { name, featureProfile, higgsFieldCharacterRef, baseImagePath } = body;

  const result = db
    .update(schema.characters)
    .set({
      ...(name !== undefined && { name }),
      ...(featureProfile !== undefined && { featureProfile }),
      ...(higgsFieldCharacterRef !== undefined && { higgsFieldCharacterRef }),
      ...(baseImagePath !== undefined && { baseImagePath }),
    })
    .where(eq(schema.characters.id, parseInt(id)))
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
  db.delete(schema.characters)
    .where(eq(schema.characters.id, parseInt(id)))
    .run();
  return NextResponse.json({ ok: true });
}
