import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/services/auth";
import { thumbnail } from "@/lib/services/google-drive";

// GET ?id=<fileId> → a preview image for the Drive picker. Proxied because
// Drive's thumbnail links need the service account's token.
export async function GET(request: NextRequest) {
  const { deny } = await requireUser();
  if (deny) return deny;
  const id = request.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  try {
    const { buffer, contentType } = await thumbnail(id);
    return new NextResponse(new Uint8Array(buffer), {
      headers: { "Content-Type": contentType, "Cache-Control": "private, max-age=3600" },
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
}
