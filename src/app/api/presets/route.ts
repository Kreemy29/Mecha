import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { desc, eq } from "drizzle-orm";

export async function GET(request: NextRequest) {
  const type = request.nextUrl.searchParams.get("type");

  let query = db
    .select()
    .from(schema.presets)
    .orderBy(desc(schema.presets.createdAt));

  if (type) {
    query = query.where(
      eq(schema.presets.type, type as "image" | "video")
    ) as typeof query;
  }

  const presets = query.all();
  return NextResponse.json(presets);
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { name, description, type, searchPromptSeed } = body;

  if (!name || !type || !searchPromptSeed) {
    return NextResponse.json(
      { error: "Name, type, and search prompt seed are required" },
      { status: 400 }
    );
  }

  const result = db
    .insert(schema.presets)
    .values({
      name,
      description: description || null,
      type,
      searchPromptSeed,
      active: true,
    })
    .returning()
    .get();

  return NextResponse.json(result, { status: 201 });
}
