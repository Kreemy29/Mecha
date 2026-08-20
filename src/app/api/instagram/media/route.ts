import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { desc, eq, inArray } from "drizzle-orm";
import {
  accountIdsWithTag,
  cacheImage,
  ensureInstagramTables,
} from "@/lib/services/instagram";

// Saved media items (bookmarks). Thumbnail is cached at save time; the video
// itself is downloaded later via /api/instagram/media/[id]/download.
//
// Scoping: ?accountId=N for one account, or ?model=X / ?niche=Y to get every
// saved clip whose source account carries that tag. Media inherits its
// account's tags, so one clip can surface under several models and niches.
export async function GET(request: NextRequest) {
  ensureInstagramTables();
  const sp = request.nextUrl.searchParams;
  const accountId = parseInt(sp.get("accountId") || "");
  const model = sp.get("model");
  const niche = sp.get("niche");

  const query = db.select().from(schema.igMedia);

  if (accountId) {
    return NextResponse.json(
      query
        .where(eq(schema.igMedia.accountId, accountId))
        .orderBy(desc(schema.igMedia.createdAt))
        .all()
    );
  }

  if (model || niche) {
    const ids = model
      ? accountIdsWithTag("model", model)
      : accountIdsWithTag("niche", niche!);
    if (ids.length === 0) return NextResponse.json([]);
    return NextResponse.json(
      query
        .where(inArray(schema.igMedia.accountId, ids))
        .orderBy(desc(schema.igMedia.createdAt))
        .all()
    );
  }

  return NextResponse.json(query.orderBy(desc(schema.igMedia.createdAt)).all());
}

export async function POST(request: NextRequest) {
  try {
    ensureInstagramTables();
    const { accountId, item } = await request.json();
    if (!item?.shortcode) {
      return NextResponse.json({ error: "item.shortcode required" }, { status: 400 });
    }

    const existing = db
      .select()
      .from(schema.igMedia)
      .where(eq(schema.igMedia.shortcode, item.shortcode))
      .get();
    if (existing) return NextResponse.json(existing);

    let thumbPath: string | null = null;
    try {
      if (item.thumbnailUrl) thumbPath = await cacheImage(item.thumbnailUrl);
    } catch {
      // thumbnail is cosmetic
    }

    const row = db
      .insert(schema.igMedia)
      .values({
        accountId: accountId ?? null,
        shortcode: item.shortcode,
        igPk: item.pk ?? null,
        caption: item.caption ?? null,
        thumbPath,
        playCount: item.playCount ?? null,
        likeCount: item.likeCount ?? null,
        commentCount: item.commentCount ?? null,
        takenAt: item.takenAt ?? null,
      })
      .returning()
      .get();
    return NextResponse.json(row);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  ensureInstagramTables();
  const sp = request.nextUrl.searchParams;
  const id = parseInt(sp.get("id") || "");
  const shortcode = sp.get("shortcode");
  if (id) {
    db.delete(schema.igMedia).where(eq(schema.igMedia.id, id)).run();
  } else if (shortcode) {
    db.delete(schema.igMedia).where(eq(schema.igMedia.shortcode, shortcode)).run();
  } else {
    return NextResponse.json({ error: "id or shortcode required" }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
