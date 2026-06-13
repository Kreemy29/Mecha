import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { desc, eq } from "drizzle-orm";

export async function GET() {
  const characters = db
    .select()
    .from(schema.characters)
    .orderBy(desc(schema.characters.createdAt))
    .all();
  return NextResponse.json(characters);
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { name, featureProfile, higgsFieldCharacterRef, baseImagePath } = body;

  if (!name || !featureProfile) {
    return NextResponse.json(
      { error: "Name and feature profile are required" },
      { status: 400 }
    );
  }

  const result = db
    .insert(schema.characters)
    .values({
      name,
      featureProfile,
      higgsFieldCharacterRef: higgsFieldCharacterRef || null,
      baseImagePath: baseImagePath || null,
    })
    .returning()
    .get();

  return NextResponse.json(result, { status: 201 });
}
