import { NextResponse } from "next/server";
import { listTools, getConnectionStatus } from "@/lib/services/higgsfield";

export async function GET() {
  const status = getConnectionStatus();
  if (!status.hasToken) {
    return NextResponse.json(
      {
        error: "Not authenticated with Higgsfield. Add HIGGSFIELD_OAUTH_TOKEN to .env.local or complete OAuth flow.",
        status,
      },
      { status: 401 }
    );
  }

  try {
    const tools = await listTools();
    return NextResponse.json({ tools, status: { ...status, connected: true } });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg, status }, { status: 500 });
  }
}
