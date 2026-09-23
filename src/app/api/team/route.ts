import { NextRequest, NextResponse } from "next/server";
import { listUsers, requireUser } from "@/lib/services/auth";
import { can } from "@/lib/roles";
import {
  activitySummary,
  openSession,
  secondsWithin,
  sessionsBetween,
  trackerKeyStatus,
} from "@/lib/services/worktime";
import { isDate, listTrends } from "@/lib/services/trends";
import { itemStatsForUser } from "@/lib/services/production";

// GET ?people=1                → everyone's id/name/role (assignee pickers)
// GET ?date=YYYY-MM-DD&from&to → the day's timesheet + activity + output per
//                                person. from/to are that local day's bounds.
// GET ...&user=ID              → adds that person's full activity timeline
export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;

  if (sp.get("people")) {
    const { deny } = await requireUser();
    if (deny) return deny;
    return NextResponse.json(
      listUsers().map((u) => ({ id: u.id, name: u.name, role: u.role }))
    );
  }

  const { deny } = await requireUser({ allow: can.viewTeam });
  if (deny) return deny;
  const date = sp.get("date");
  const from = sp.get("from");
  const to = sp.get("to");
  if (!isDate(date) || !from || !to) {
    return NextResponse.json({ error: "date, from and to are required" }, { status: 400 });
  }
  const detailFor = Number(sp.get("user")) || null;

  const trends = listTrends({ date });
  const people = listUsers().map((u) => {
    const sessions = sessionsBetween(from, to, u.id);
    const activity = activitySummary(u.id, from, to);
    const mine = trends.filter((t) => t.createdById === u.id);
    return {
      id: u.id,
      name: u.name,
      role: u.role,
      clockedIn: !!openSession(u.id),
      sessions,
      workedSeconds: sessions.reduce((sum, s) => sum + secondsWithin(s, from, to), 0),
      tracker: trackerKeyStatus(u.id),
      activity: {
        browseSeconds: activity.browseSeconds,
        idleSeconds: activity.idleSeconds,
        awaySeconds: activity.awaySeconds,
        domains: activity.domains.slice(0, 8),
        lastActivityAt: activity.lastActivityAt,
        ...(detailFor === u.id ? { pages: activity.pages, timeline: activity.timeline } : {}),
      },
      trends: {
        total: mine.length,
        approved: mine.filter((t) => t.status === "approved").length,
        rejected: mine.filter((t) => t.status === "rejected").length,
        pending: mine.filter((t) => t.status === "pending").length,
      },
      items: itemStatsForUser(u.id, from, to),
    };
  });

  return NextResponse.json(people);
}
