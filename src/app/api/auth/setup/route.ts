import { NextRequest, NextResponse } from "next/server";
import {
  createSession,
  createUser,
  isRole,
  SESSION_COOKIE,
  SESSION_MAX_AGE,
  userCount,
} from "@/lib/services/auth";

// First-run only: create the founding admin account. Guarded by the user count
// rather than a setup token, and refuses once anybody exists — otherwise this
// route would be a permanent "make me an admin" endpoint.
export async function POST(request: NextRequest) {
  try {
    if (userCount() > 0) {
      return NextResponse.json(
        { error: "Setup already completed — ask an admin for an account" },
        { status: 403 }
      );
    }

    const { username, name, password, role, token: setupCode } = await request.json();

    // On a public URL an empty database is a land-grab: the first stranger to
    // find the app becomes the admin. SETUP_TOKEN closes that window — set it
    // in the host's env and only someone holding it can claim the account.
    // Skipped when unset so local development stays frictionless.
    const required = process.env.SETUP_TOKEN;
    if (required && setupCode !== required) {
      return NextResponse.json(
        { error: "Wrong setup code" },
        { status: 403 }
      );
    }
    if (!username?.trim() || !password) {
      return NextResponse.json(
        { error: "Username and password are required" },
        { status: 400 }
      );
    }

    const user = createUser({
      username,
      name: name || username,
      role: isRole(role) ? role : "owner",
      password,
      isAdmin: true,
    });

    const token = createSession(user.id);
    const res = NextResponse.json({ user }, { status: 201 });
    res.cookies.set(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: SESSION_MAX_AGE,
      secure: process.env.NODE_ENV === "production",
    });
    return res;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
