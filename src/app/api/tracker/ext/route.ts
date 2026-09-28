import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { eq } from "drizzle-orm";
import { CONSENT_VERSION } from "@/lib/tracking-consent";
import { ensureAuthTables } from "@/lib/services/auth";
import {
  clockIn,
  clockOut,
  consentStatus,
  endBreak,
  openSession,
  recordActivity,
  startBreak,
  userIdForTrackerKey,
  type ActivitySegment,
} from "@/lib/services/worktime";

// Everything the trackers talk to: the Chrome extension (extension/) and the
// Windows desktop tracker (desktop-tracker/). Public in proxy.ts —
// authentication is the per-user tracker key in the Authorization header,
// never a cookie, so allowing any origin is safe and spares the extension
// from needing host permissions.
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
};

const json = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: CORS });

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}

// body: {
//   action: "status" | "clock_in" | "clock_out" | "break_start" | "break_end" | "activity",
//   source?: "chrome" | "desktop"   (default chrome, for the existing extension)
//   segments?
// }
export async function POST(request: NextRequest) {
  const auth = request.headers.get("authorization") || "";
  const key = auth.replace(/^Bearer\s+/i, "").trim();
  const userId = key ? userIdForTrackerKey(key) : null;
  if (!userId) return json({ error: "Unknown tracker key" }, 401);
  ensureAuthTables();
  const user = db.select().from(schema.users).where(eq(schema.users.id, userId)).get();
  if (!user) return json({ error: "Account deleted" }, 401);

  let body: { action?: string; source?: string; segments?: ActivitySegment[] } = {};
  try {
    body = await request.json();
  } catch {
    // empty body → status
  }
  const source = body.source === "desktop" ? "desktop" : "chrome";

  let kept = 0;
  switch (body.action) {
    case "clock_in":
      clockIn(userId);
      break;
    case "clock_out":
      clockOut(userId);
      break;
    case "break_start":
      startBreak(userId);
      break;
    case "break_end":
      endBreak(userId);
      break;
    case "activity":
      kept = recordActivity(
        userId,
        Array.isArray(body.segments) ? body.segments : [],
        source,
        CONSENT_VERSION
      );
      break;
  }

  const session = openSession(userId);
  const consent = consentStatus(userId, CONSENT_VERSION);
  return json({
    name: user.name,
    clockedIn: !!session,
    onBreak: !!session?.onBreak,
    clockIn: session?.clockIn ?? null,
    // Trackers show "give permission in the app" and record nothing until
    // this is true; the server drops their activity regardless.
    consent: consent.accepted,
    kept,
  });
}
