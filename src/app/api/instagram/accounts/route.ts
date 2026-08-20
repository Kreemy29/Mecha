import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { eq } from "drizzle-orm";
import {
  cacheImage,
  ensureInstagramTables,
  fetchProfile,
  setAccountTags,
  tagsByAccount,
} from "@/lib/services/instagram";

// Saved Instagram accounts (the "preselected models" list). Each row carries
// its `models` / `niches` arrays — an account can belong to several of each.
export async function GET() {
  ensureInstagramTables();
  const rows = db
    .select()
    .from(schema.igAccounts)
    .orderBy(schema.igAccounts.createdAt)
    .all();
  const tags = tagsByAccount();
  return NextResponse.json(
    rows.map((r) => ({
      ...r,
      models: tags.get(r.id)?.models ?? [],
      niches: tags.get(r.id)?.niches ?? [],
    }))
  );
}

// Normalize a tag payload: accept an array, or undefined to mean "leave as is".
function tagList(v: unknown): string[] | undefined {
  if (v === undefined || v === null) return undefined;
  if (Array.isArray(v)) return v.map((x) => String(x));
  const s = String(v).trim();
  return s ? [s] : [];
}

// Add (or refresh) an account by username: pull userInfo, cache the avatar
// locally, upsert the row.
export async function POST(request: NextRequest) {
  try {
    ensureInstagramTables();
    const body = await request.json();
    const clean = String(body.username || "")
      .trim()
      .replace(/^@/, "")
      .toLowerCase();
    if (!clean) {
      return NextResponse.json({ error: "username required" }, { status: 400 });
    }

    const models = tagList(body.models ?? body.modelName);
    const niches = tagList(body.niches ?? body.niche);

    const profile = await fetchProfile(clean);
    let profilePicPath: string | null = null;
    try {
      profilePicPath = await cacheImage(profile.profilePicUrl);
    } catch {
      // avatar is cosmetic — don't fail the add over it
    }

    const values = {
      username: profile.username.toLowerCase(),
      igPk: profile.pk,
      fullName: profile.fullName,
      biography: profile.biography,
      profilePicPath,
      followerCount: profile.followerCount,
      mediaCount: profile.mediaCount,
      lastSyncedAt: new Date().toISOString(),
    };

    const existing = db
      .select()
      .from(schema.igAccounts)
      .where(eq(schema.igAccounts.username, values.username))
      .get();

    const row = existing
      ? db
          .update(schema.igAccounts)
          .set(values)
          .where(eq(schema.igAccounts.id, existing.id))
          .returning()
          .get()
      : db.insert(schema.igAccounts).values(values).returning().get();

    // A plain refresh posts no tags at all (undefined) — that leaves the
    // existing assignments untouched rather than clearing them.
    setAccountTags(row.id, "model", models);
    setAccountTags(row.id, "niche", niches);

    const tags = tagsByAccount().get(row.id);
    return NextResponse.json({
      ...row,
      models: tags?.models ?? [],
      niches: tags?.niches ?? [],
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// Retag an existing account (model / niche) without re-fetching the profile.
export async function PATCH(request: NextRequest) {
  try {
    ensureInstagramTables();
    const body = await request.json();
    const id = body.id;
    if (!id) {
      return NextResponse.json({ error: "id required" }, { status: 400 });
    }

    setAccountTags(id, "model", tagList(body.models ?? body.modelName));
    setAccountTags(id, "niche", tagList(body.niches ?? body.niche));

    const row = db
      .select()
      .from(schema.igAccounts)
      .where(eq(schema.igAccounts.id, id))
      .get();
    if (!row) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const tags = tagsByAccount().get(id);
    return NextResponse.json({
      ...row,
      models: tags?.models ?? [],
      niches: tags?.niches ?? [],
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  ensureInstagramTables();
  const id = parseInt(request.nextUrl.searchParams.get("id") || "");
  if (!id) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }
  // Keep saved media rows (they may have downloaded videos) but detach them.
  db.update(schema.igMedia)
    .set({ accountId: null })
    .where(eq(schema.igMedia.accountId, id))
    .run();
  db.delete(schema.igAccountTags)
    .where(eq(schema.igAccountTags.accountId, id))
    .run();
  db.delete(schema.igAccounts).where(eq(schema.igAccounts.id, id)).run();
  return NextResponse.json({ ok: true });
}
