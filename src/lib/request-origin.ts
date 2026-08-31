import type { NextRequest } from "next/server";

// On Render, the request Next.js sees carries Host: localhost:<container
// port> — the container's own internal address — not the public onrender.com
// hostname. request.nextUrl.origin trusts that Host header verbatim, which is
// why the Higgsfield OAuth screen and uploaded-file URLs were showing
// "localhost". The standard reverse-proxy headers still carry the real
// address, so prefer those when present.
export function publicOrigin(request: NextRequest): string {
  const proto =
    request.headers.get("x-forwarded-proto")?.split(",")[0].trim() ||
    request.nextUrl.protocol.replace(":", "");
  const host =
    request.headers.get("x-forwarded-host")?.split(",")[0].trim() ||
    request.headers.get("host") ||
    request.nextUrl.host;
  return `${proto}://${host}`;
}
