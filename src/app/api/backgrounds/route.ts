import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { desc, eq } from "drizzle-orm";

// Saved backgrounds — each holds a frozen description reused verbatim.
export async function GET() {
  const rows = db
    .select()
    .from(schema.backgrounds)
    .orderBy(desc(schema.backgrounds.createdAt))
    .all();
  return NextResponse.json(rows);
}

export async function POST(request: NextRequest) {
  const { name, description, imagePath } = await request.json();
  if (!name?.trim() || !description?.trim()) {
    return NextResponse.json(
      { error: "name and description are required" },
      { status: 400 }
    );
  }
  const row = db
    .insert(schema.backgrounds)
    .values({
      name: name.trim(),
      description: description.trim(),
      imagePath: imagePath || null,
    })
    .returning()
    .get();
  return NextResponse.json(row, { status: 201 });
}

export async function DELETE(request: NextRequest) {
  const id = parseInt(request.nextUrl.searchParams.get("id") || "");
  if (!id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }
  db.delete(schema.backgrounds).where(eq(schema.backgrounds.id, id)).run();
  return NextResponse.json({ ok: true });
}
