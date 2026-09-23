import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { eq } from "drizzle-orm";
import {
  clockIn,
  clockOut,
  openSession,
  recordActivity,
  userIdForTrackerKey,
  type ActivitySegment,
} from "@/lib/services/worktime";

// Everything the Chrome extension (extension/) talks to. Public in proxy.ts —
// authentication is the per-user tracker key in the Authorization header,
// never a cookie, so allowing any origin (the extension's chrome-extension://
// origin) is safe and spares the extension from needing host permissions.
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

// body: { action: "status" | "clock_in" | "clock_out" | "activity", segments? }
export async function POST(request: NextRequest) {
  const auth = request.headers.get("authorization") || "";
  const key = auth.replace(/^Bearer\s+/i, "").trim();
  const userId = key ? userIdForTrackerKey(key) : null;
  if (!userId) return json({ error: "Unknown tracker key" }, 401);
  const user = db.select().from(schema.users).where(eq(schema.users.id, userId)).get();
  if (!user) return json({ error: "Account deleted" }, 401);

  let body: { action?: string; segments?: ActivitySegment[] } = {};
  try {
    body = await request.json();
  } catch {
    // empty body → status
  }

  let kept = 0;
  switch (body.action) {
    case "clock_in":
      clockIn(userId);
      break;
    case "clock_out":
      clockOut(userId);
      break;
    case "activity":
      kept = recordActivity(userId, Array.isArray(body.segments) ? body.segments : []);
      break;
  }

  const session = openSession(userId);
  return json({
    name: user.name,
    clockedIn: !!session,
    clockIn: session?.clockIn ?? null,
    kept,
  });
}
