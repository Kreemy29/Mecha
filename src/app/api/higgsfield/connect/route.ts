import { NextRequest, NextResponse } from "next/server";
import { buildAuthorizeUrl } from "@/lib/services/higgsfield-oauth";
import { publicOrigin } from "@/lib/request-origin";

// Kicks off the OAuth flow: registers a client, builds the PKCE authorize URL,
// and redirects the browser to Higgsfield's web auth page.
export async function GET(request: NextRequest) {
  try {
    const origin = publicOrigin(request);
    const authUrl = await buildAuthorizeUrl(origin);
    return NextResponse.redirect(authUrl);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    const origin = publicOrigin(request);
    return NextResponse.redirect(
      `${origin}/settings?hf_error=${encodeURIComponent(msg)}`
    );
  }
}
