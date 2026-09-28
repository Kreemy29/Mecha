import { CLOCKED_ROLES } from "@/lib/roles";
import type { PublicUser } from "./auth";
import { openSession } from "./worktime";

// Researchers and creators must be on the clock to hand work in — otherwise
// the timesheet and the output stop lining up. A break counts as off the
// clock for this. Returns a ready 409 or null.
export function requireClockedIn(user: PublicUser): Response | null {
  if (!CLOCKED_ROLES.includes(user.role)) return null;
  const session = openSession(user.id);
  if (!session) return Response.json({ error: "Clock in first (top right)" }, { status: 409 });
  if (session.onBreak) return Response.json({ error: "You're on a break. End it to submit." }, { status: 409 });
  return null;
}
