import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/services/auth";
import {
  clockIn,
  clockOut,
  heartbeat,
  openSession,
  secondsWithin,
  sessionsBetween,
  trackerKeyStatus,
} from "@/lib/services/worktime";

// The signed-in user's own clock. `from`/`to` are the client's local day
// boundaries (ISO), so "today" means the user's today, not the server's.
function status(userId: number, from: string | null, to: string | null) {
  const session = openSession(userId);
  let todaySeconds = 0;
  if (from && to) {
    for (const s of sessionsBetween(from, to, userId)) {
      todaySeconds += secondsWithin(s, from, to);
    }
  }
  return { session, todaySeconds, tracker: trackerKeyStatus(userId) };
}

export async function GET(request: NextRequest) {
  const { user, deny } = await requireUser();
  if (deny) return deny;
  const sp = request.nextUrl.searchParams;
  return NextResponse.json(status(user.id, sp.get("from"), sp.get("to")));
}

export async function POST(request: NextRequest) {
  const { user, deny } = await requireUser();
  if (deny) return deny;
  const { action, from, to } = await request.json();
  if (action === "in") clockIn(user.id);
  else if (action === "out") clockOut(user.id);
  else if (action === "heartbeat") heartbeat(user.id);
  else return NextResponse.json({ error: "action must be in|out|heartbeat" }, { status: 400 });
  return NextResponse.json(status(user.id, from ?? null, to ?? null));
}
