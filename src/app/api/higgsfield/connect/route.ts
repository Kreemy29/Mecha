import { NextRequest, NextResponse } from "next/server";
import { connectUrl } from "@/lib/services/higgsfield-oauth";
import { publicOrigin } from "@/lib/request-origin";
import { requireUser } from "@/lib/services/auth";

// Kicks off the OAuth flow: registers a client, builds the PKCE authorize URL.
//   GET ?json=1 → { authUrl, mode } for the Settings button. mode "redirect":
//                 Higgsfield sends the browser back to our callback.
//                 mode "paste": a hosted copy, whose own address Higgsfield
//                 won't accept; the person pastes the loopback address they
//                 land on (see services/higgsfield-oauth.ts).
//   GET         → straight redirect to Higgsfield (the old link behaviour).
export async function GET(request: NextRequest) {
  const { deny } = await requireUser();
  if (deny) return deny;
  const origin = publicOrigin(request);
  const wantsJson = request.nextUrl.searchParams.get("json");
  try {
    const { authUrl, mode } = await connectUrl(origin);
    if (wantsJson) return NextResponse.json({ authUrl, mode });
    return NextResponse.redirect(authUrl);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (wantsJson) return NextResponse.json({ error: msg }, { status: 502 });
    return NextResponse.redirect(`${origin}/settings?hf_error=${encodeURIComponent(msg)}`);
  }
}
