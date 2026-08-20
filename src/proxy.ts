import { NextRequest, NextResponse } from "next/server";

// Front door. In Next 16 this file is `proxy.ts` (the old `middleware.ts`
// convention is deprecated — see docs/01-app/01-getting-started/16-proxy.md).
//
// This is an OPTIMISTIC check only: it reads the session cookie and bounces
// anyone without one to the login screen. Next's own auth guide is explicit
// that proxy runs on every route including prefetches, so it must not hit the
// database. The real boundary is `requireUser()` next to the data.

const COOKIE = "oneup_session";

// Reachable signed-out: the login screen itself and the endpoints it calls.
const PUBLIC_PATHS = [
  "/login",
  "/api/auth/login",
  "/api/auth/logout",
  "/api/auth/session",
  "/api/auth/setup",
];

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    return NextResponse.next();
  }

  if (request.cookies.get(COOKIE)?.value) return NextResponse.next();

  // APIs get a 401 rather than an HTML redirect, so fetch() callers see a
  // clean failure instead of parsing a login page as JSON.
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.search = pathname === "/" ? "" : `?next=${encodeURIComponent(pathname)}`;
  return NextResponse.redirect(url);
}

export const config = {
  // Everything except Next's own assets and the favicon.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};

