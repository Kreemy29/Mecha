import { NextRequest, NextResponse } from "next/server";
import { saveOAuthToken, getOAuthUrl } from "@/lib/services/higgsfield";

// GET: return the OAuth URL to redirect the user to
export async function GET() {
  const authUrl = getOAuthUrl();
  return NextResponse.json({ authUrl });
}

// POST: save a token (manually pasted or received from OAuth callback)
export async function POST(request: NextRequest) {
  const { accessToken, refreshToken } = await request.json();

  if (!accessToken) {
    return NextResponse.json(
      { error: "accessToken is required" },
      { status: 400 }
    );
  }

  saveOAuthToken(accessToken, refreshToken);
  return NextResponse.json({ ok: true, message: "Token saved" });
}
