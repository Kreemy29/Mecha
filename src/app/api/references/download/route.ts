import { NextRequest, NextResponse } from "next/server";
import { downloadImage, downloadInstagramReel } from "@/lib/services/references";
import { db, schema } from "@/lib/db";

export async function POST(request: NextRequest) {
  const { imageUrl, reelUrl, batchId, sourceKind } = await request.json();

  try {
    if (reelUrl) {
      const { videoPath, framePath } = await downloadInstagramReel(reelUrl);
      const ref = db
        .insert(schema.references)
        .values({
          batchId: batchId || null,
          sourceUrl: reelUrl,
          sourceKind: "instagram",
          localPath: videoPath,
          framePath: framePath || null,
          selected: false,
        })
        .returning()
        .get();
      return NextResponse.json(ref, { status: 201 });
    }

    if (imageUrl) {
      const localPath = await downloadImage(imageUrl);
      const ref = db
        .insert(schema.references)
        .values({
          batchId: batchId || null,
          sourceUrl: imageUrl,
          sourceKind: sourceKind || "pinterest",
          localPath,
          framePath: null,
          selected: false,
        })
        .returning()
        .get();
      return NextResponse.json(ref, { status: 201 });
    }

    return NextResponse.json(
      { error: "imageUrl or reelUrl is required" },
      { status: 400 }
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
