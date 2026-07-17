import { NextRequest, NextResponse } from "next/server";
import { saveUploadedImage } from "@/lib/services/references";

// Accept one or more uploaded images (multipart) and return them in the same
// shape as Pinterest results, so the existing reference-selection + recreation
// flow works unchanged. imageUrl is absolute so the server can fetch it during
// the Grok vision call.
export async function POST(request: NextRequest) {
  try {
    const form = await request.formData();
    const files = form.getAll("files");
    if (files.length === 0) {
      return NextResponse.json({ error: "No files provided" }, { status: 400 });
    }

    const origin = request.nextUrl.origin;
    const results = [];
    for (const f of files) {
      if (typeof f === "string") continue;
      const buffer = Buffer.from(await f.arrayBuffer());
      const rel = await saveUploadedImage(buffer, f.name);
      const url = `${origin}/api/files/${rel.replace(/\\/g, "/")}`;
      results.push({
        imageUrl: url,
        thumbnailUrl: url,
        title: f.name,
        sourceUrl: "",
        path: rel, // local relative path (for jobs that need to read the file)
      });
    }

    return NextResponse.json({ results });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
