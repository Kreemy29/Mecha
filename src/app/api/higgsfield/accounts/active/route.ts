import { NextRequest, NextResponse } from "next/server";
import { setActiveAccount } from "@/lib/services/higgsfield-accounts";

// POST { id } — switches which connected Higgsfield account job submission,
// character sync, and any Methods call that doesn't name an explicit account
// target by default.
export async function POST(request: NextRequest) {
  try {
    const { id } = await request.json();
    if (!id) {
      return NextResponse.json({ error: "id required" }, { status: 400 });
    }
    setActiveAccount(id);
    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
