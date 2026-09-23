import { NextRequest, NextResponse } from "next/server";
import {
  currentUser,
  SESSION_COOKIE,
  SESSION_MAX_AGE,
  touchSession,
  userCount,
} from "@/lib/services/auth";

// Who am I, and does this install have any accounts yet? The login screen uses
// `needsSetup` to decide between "sign in" and "create the first account".
//
// Every app page calls this on load, so it's also where a session slides
// forward: the DB expiry and the cookie are both renewed, which is what keeps
// people signed in indefinitely as long as they keep using the app.
export async function GET(request: NextRequest) {
  const user = await currentUser();
  const res = NextResponse.json({
    user,
    needsSetup: userCount() === 0,
    // Tells the first-run form whether to ask for the setup code. The code
    // itself never leaves the server.
    needsSetupToken: !!process.env.SETUP_TOKEN,
  });
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (user && token && touchSession(token)) {
    res.cookies.set(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: SESSION_MAX_AGE,
      secure: process.env.NODE_ENV === "production",
    });
  }
  return res;
}
