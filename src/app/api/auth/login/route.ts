import { NextRequest, NextResponse } from "next/server";
import {
  authenticate,
  createSession,
  SESSION_COOKIE,
  SESSION_MAX_AGE,
} from "@/lib/services/auth";

export async function POST(request: NextRequest) {
  try {
    const { username, password } = await request.json();
    if (!username?.trim() || !password) {
      return NextResponse.json(
        { error: "Username and password are required" },
        { status: 400 }
      );
    }

    const user = authenticate(username, password);
    if (!user) {
      // Deliberately vague: saying which half was wrong tells an attacker
      // which usernames exist.
      return NextResponse.json(
        { error: "Wrong username or password" },
        { status: 401 }
      );
    }

    const token = createSession(user.id);
    const res = NextResponse.json({ user });
    res.cookies.set(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: SESSION_MAX_AGE,
      // Set over HTTPS in production; leaving it off in dev keeps localhost
      // working without a certificate.
      secure: process.env.NODE_ENV === "production",
    });
    return res;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
