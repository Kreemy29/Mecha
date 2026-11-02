import { NextRequest, NextResponse } from "next/server";
import { exchangeCodeForToken, exchangePastedRedirect } from "@/lib/services/higgsfield-oauth";
import { publicOrigin } from "@/lib/request-origin";
import { requireUser } from "@/lib/services/auth";

// { url } → finish a "paste" sign-in: the loopback address the browser landed
// on after approving on Higgsfield, which carries the code.
export async function POST(request: NextRequest) {
  const { deny } = await requireUser();
  if (deny) return deny;
  const { url } = await request.json();
  try {
    await exchangePastedRedirect(String(url ?? ""));
    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
  }
}

// Higgsfield redirects here after the user approves. We exchange the code for a
// token, save it, and bounce back to Settings.
export async function GET(request: NextRequest) {
  const origin = publicOrigin(request);
  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");
  const error = request.nextUrl.searchParams.get("error");

  if (error) {
    const desc = request.nextUrl.searchParams.get("error_description") || error;
    return NextResponse.redirect(
      `${origin}/settings?hf_error=${encodeURIComponent(desc)}`
    );
  }

  if (!code || !state) {
    return NextResponse.redirect(
      `${origin}/settings?hf_error=${encodeURIComponent("Missing code or state")}`
    );
  }

  try {
    await exchangeCodeForToken(code, state);
    return NextResponse.redirect(`${origin}/settings?hf_connected=1`);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.redirect(
      `${origin}/settings?hf_error=${encodeURIComponent(msg)}`
    );
  }
}
