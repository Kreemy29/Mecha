import crypto from "crypto";
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
    // Normalised on both sides: a stray space/newline or wrapping quotes from
    // copying the value in or out of the host's dashboard are invisible and
    // shouldn't lock you out.
    const clean = (v: unknown) =>
      String(v ?? "").trim().replace(/^(["'])(.*)\1$/, "$2").trim();
    const required = process.env.SETUP_TOKEN ? clean(process.env.SETUP_TOKEN) : "";
    if (required && clean(setupCode) !== required) {
      // A short hash + length of each side, so "I typed it exactly" can be
      // told apart from "the server holds a different value" without the
      // code itself ever leaving the server. 8 hex chars of SHA-256 give
      // nothing usable for guessing a long random token.
      const fp = (v: string) =>
        `${v.length} chars, fingerprint ${crypto.createHash("sha256").update(v).digest("hex").slice(0, 8)}`;
      return NextResponse.json(
        {
          error: `Wrong setup code. Server's code: ${fp(required)}. Yours: ${fp(clean(setupCode))}.`,
        },
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
