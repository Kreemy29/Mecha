import { NextRequest, NextResponse } from "next/server";
import { buildAuthorizeUrl } from "@/lib/services/higgsfield-oauth";

// Kicks off the OAuth flow: registers a client, builds the PKCE authorize URL,
// and redirects the browser to Higgsfield's web auth page.
export async function GET(request: NextRequest) {
  try {
    const origin = request.nextUrl.origin;
    const authUrl = await buildAuthorizeUrl(origin);
    return NextResponse.redirect(authUrl);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    const origin = request.nextUrl.origin;
    return NextResponse.redirect(
      `${origin}/settings?hf_error=${encodeURIComponent(msg)}`
    );
  }
}
