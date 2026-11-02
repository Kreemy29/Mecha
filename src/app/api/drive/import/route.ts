import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/services/auth";
import { downloadFile } from "@/lib/services/google-drive";
import { saveUploadedImage } from "@/lib/services/references";
import { publicOrigin } from "@/lib/request-origin";

// { fileIds } → copies those Drive images into storage/references and returns
// them in the same shape as an upload (and Pinterest results), so the rest of
// the Images flow (select → recreation prompt → generate) works unchanged.
export async function POST(request: NextRequest) {
  const { deny } = await requireUser();
  if (deny) return deny;
  const { fileIds } = await request.json();
  if (!Array.isArray(fileIds) || fileIds.length === 0) {
    return NextResponse.json({ error: "Pick at least one image" }, { status: 400 });
  }
  if (fileIds.length > 100) {
    return NextResponse.json({ error: "Import at most 100 images at a time" }, { status: 400 });
  }

  const origin = publicOrigin(request);
  const results = [];
  const failed: string[] = [];
  for (const id of fileIds.map(String)) {
    try {
      const file = await downloadFile(id);
      const rel = await saveUploadedImage(file.buffer, file.name);
      const url = `${origin}/api/files/${rel.replace(/\\/g, "/")}`;
      results.push({ imageUrl: url, thumbnailUrl: url, title: file.name, sourceUrl: "", path: rel });
    } catch (err) {
      failed.push(err instanceof Error ? err.message : String(err));
    }
  }
  return NextResponse.json({ results, failed });
}
