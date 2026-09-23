import { NextResponse } from "next/server";
import { requireUser } from "@/lib/services/auth";
import { createTrackerKey, trackerKeyStatus } from "@/lib/services/worktime";

// The signed-in user's Chrome tracker key. The plaintext is only ever shown
// once, right after it's generated; generating again revokes the old one.
export async function GET() {
  const { user, deny } = await requireUser();
  if (deny) return deny;
  return NextResponse.json(trackerKeyStatus(user.id));
}

export async function POST() {
  const { user, deny } = await requireUser();
  if (deny) return deny;
  return NextResponse.json({ key: createTrackerKey(user.id) });
}
