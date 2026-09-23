import { CLOCKED_ROLES } from "@/lib/roles";
import type { PublicUser } from "./auth";
import { openSession } from "./worktime";

// Researchers and creators must be on the clock to hand work in — otherwise
// the timesheet and the output stop lining up. Returns a ready 409 or null.
export function requireClockedIn(user: PublicUser): Response | null {
  if (!CLOCKED_ROLES.includes(user.role)) return null;
  if (openSession(user.id)) return null;
  return Response.json({ error: "Clock in first (top right)" }, { status: 409 });
}
