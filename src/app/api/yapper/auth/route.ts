import { NextRequest, NextResponse } from "next/server";
import { saveApiKey } from "@/lib/services/yapper";

// POST — save a pasted Yapper API key (yap_live_...) as a connected account.
// Yapper has no OAuth flow for the REST API, so this is the only connect path.
export async function POST(request: NextRequest) {
  try {
    const { apiKey, label } = await request.json();
    if (!apiKey) {
      return NextResponse.json({ error: "apiKey is required" }, { status: 400 });
    }
    await saveApiKey(apiKey, label);
    return NextResponse.json({ ok: true, message: "API key saved" });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
