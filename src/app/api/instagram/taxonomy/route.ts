import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { and, eq } from "drizzle-orm";
import {
  ensureInstagramTables,
  rememberTaxonomy,
} from "@/lib/services/instagram";

// The remembered model / niche options offered when adding an account.
// Model options are seeded with the project's existing characters, since those
// are the "our models" the operator is drawing inspiration for.
export async function GET() {
  ensureInstagramTables();
  const rows = db.select().from(schema.igTaxonomy).all();

  const models = new Set(
    rows.filter((r) => r.kind === "model").map((r) => r.value)
  );
  const niches = rows.filter((r) => r.kind === "niche").map((r) => r.value);

  for (const c of db.select().from(schema.characters).all()) {
    if (c.name) models.add(c.name);
  }

  return NextResponse.json({
    models: [...models].sort((a, b) => a.localeCompare(b)),
    niches: niches.sort((a, b) => a.localeCompare(b)),
  });
}

export async function POST(request: NextRequest) {
  const { kind, value } = await request.json();
  if (kind !== "model" && kind !== "niche") {
    return NextResponse.json({ error: "kind must be model|niche" }, { status: 400 });
  }
  rememberTaxonomy(kind, String(value ?? ""));
  return NextResponse.json({ ok: true });
}

// Forget an option. Accounts already tagged with it keep their value.
export async function DELETE(request: NextRequest) {
  ensureInstagramTables();
  const sp = request.nextUrl.searchParams;
  const kind = sp.get("kind");
  const value = sp.get("value");
  if ((kind !== "model" && kind !== "niche") || !value) {
    return NextResponse.json({ error: "kind and value required" }, { status: 400 });
  }
  db.delete(schema.igTaxonomy)
    .where(
      and(eq(schema.igTaxonomy.kind, kind), eq(schema.igTaxonomy.value, value))
    )
    .run();
  return NextResponse.json({ ok: true });
}
