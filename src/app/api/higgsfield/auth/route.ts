import { NextRequest, NextResponse } from "next/server";
import { saveOAuthToken, getOAuthUrl } from "@/lib/services/higgsfield";

// GET: return the OAuth URL to redirect the user to
export async function GET() {
  const authUrl = getOAuthUrl();
  return NextResponse.json({ authUrl });
}

// POST: save a manually pasted token as a new connected account
export async function POST(request: NextRequest) {
  const { accessToken, refreshToken, label } = await request.json();

  if (!accessToken) {
    return NextResponse.json(
      { error: "accessToken is required" },
      { status: 400 }
    );
  }

  saveOAuthToken(accessToken, refreshToken, label);
  return NextResponse.json({ ok: true, message: "Token saved" });
}
