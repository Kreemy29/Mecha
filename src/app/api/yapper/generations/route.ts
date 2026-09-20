import { NextRequest, NextResponse } from "next/server";
import { listGenerations } from "@/lib/services/yapper";

const VALID_TYPES = new Set(["image", "video", "audio"]);

// GET /api/yapper/generations?cursor=...&type=video&account=<id>
// Browses one connected Yapper account's process history — mirrors
// /api/higgsfield/generations. Omit `account` to browse whichever account is
// currently active.
export async function GET(request: NextRequest) {
  try {
    const cursor = request.nextUrl.searchParams.get("cursor") || undefined;
    const typeParam = request.nextUrl.searchParams.get("type") || undefined;
    const type =
      typeParam && VALID_TYPES.has(typeParam) ? (typeParam as "image" | "video" | "audio") : undefined;
    const accountId = request.nextUrl.searchParams.get("account") || undefined;
    const page = await listGenerations(cursor, type, accountId);
    return NextResponse.json(page);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
