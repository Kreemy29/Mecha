import { NextRequest, NextResponse } from "next/server";
import { listUsers, requireUser } from "@/lib/services/auth";
import { can } from "@/lib/roles";
import { openSession, sessionsBetween } from "@/lib/services/worktime";

// Raw clock sessions for a range; the client splits them into its own local
// days (lib/day.ts secondsByDay), so "Tuesday" means the viewer's Tuesday.
//
// GET ?from=ISO&to=ISO         → the signed-in user's sessions
// GET ?from=ISO&to=ISO&all=1   → everyone's, grouped per person (managers/CEO)
export async function GET(request: NextRequest) {
  const { user, deny } = await requireUser();
  if (deny) return deny;
  const sp = request.nextUrl.searchParams;
  const from = sp.get("from");
  const to = sp.get("to");
  if (!from || !to || Number.isNaN(Date.parse(from)) || Number.isNaN(Date.parse(to))) {
    return NextResponse.json({ error: "from and to are required" }, { status: 400 });
  }

  if (sp.get("all")) {
    if (!can.viewTeam(user)) {
      return NextResponse.json({ error: "Managers only" }, { status: 403 });
    }
    const sessions = sessionsBetween(from, to);
    return NextResponse.json(
      listUsers().map((u) => ({
        id: u.id,
        name: u.name,
        role: u.role,
        clockedIn: !!openSession(u.id),
        sessions: sessions.filter((s) => s.userId === u.id),
      }))
    );
  }

  return NextResponse.json({ sessions: sessionsBetween(from, to, user.id) });
}
