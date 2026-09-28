import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/services/auth";
import {
  breakSecondsWithin,
  clockIn,
  clockOut,
  endBreak,
  heartbeat,
  openSession,
  secondsWithin,
  sessionsBetween,
  startBreak,
  trackerKeyStatus,
} from "@/lib/services/worktime";

type Punch = { at: string; kind: "in" | "out" | "break_start" | "break_end"; auto?: boolean };

// The signed-in user's own clock. `from`/`to` are the client's local day
// boundaries (ISO), so "today" means the user's today, not the server's.
function status(userId: number, from: string | null, to: string | null) {
  const session = openSession(userId);
  let todaySeconds = 0;
  let todayBreakSeconds = 0;
  const punches: Punch[] = [];
  if (from && to) {
    for (const s of sessionsBetween(from, to, userId)) {
      todaySeconds += secondsWithin(s, from, to);
      todayBreakSeconds += breakSecondsWithin(s, from, to);
      punches.push({ at: s.clockIn, kind: "in" });
      for (const b of s.breaks) {
        punches.push({ at: b.start, kind: "break_start" });
        if (b.end) punches.push({ at: b.end, kind: "break_end" });
      }
      if (s.clockOut) punches.push({ at: s.clockOut, kind: "out", auto: s.autoClosed });
    }
  }
  punches.sort((a, b) => a.at.localeCompare(b.at));
  return {
    session,
    // When the totals below were computed: the client adds the time elapsed
    // since, to whichever of worked/break is currently running.
    asOf: new Date().toISOString(),
    todaySeconds,
    todayBreakSeconds,
    punches: punches.filter((p) => !from || !to || (p.at >= from && p.at < to)),
    tracker: trackerKeyStatus(userId),
  };
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
  switch (action) {
    case "in":
      clockIn(user.id);
      break;
    case "out":
      clockOut(user.id);
      break;
    case "break_start":
      startBreak(user.id);
      break;
    case "break_end":
      endBreak(user.id);
      break;
    case "heartbeat":
      heartbeat(user.id);
      break;
    default:
      return NextResponse.json(
        { error: "action must be in|out|break_start|break_end|heartbeat" },
        { status: 400 }
      );
  }
  return NextResponse.json(status(user.id, from ?? null, to ?? null));
}
