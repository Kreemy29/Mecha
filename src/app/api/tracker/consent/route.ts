import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/services/auth";
import { CONSENT_VERSION } from "@/lib/tracking-consent";
import { consentStatus, setConsent } from "@/lib/services/worktime";

// The signed-in user's own permission for activity tracking. Only they can
// give or withdraw it — nobody else, admins included.
export async function GET() {
  const { user, deny } = await requireUser();
  if (deny) return deny;
  return NextResponse.json({ ...consentStatus(user.id, CONSENT_VERSION), currentVersion: CONSENT_VERSION });
}

// { accept: true } → agree to the current version · { accept: false } → withdraw
export async function POST(request: NextRequest) {
  const { user, deny } = await requireUser();
  if (deny) return deny;
  const { accept } = await request.json();
  setConsent(user.id, CONSENT_VERSION, !!accept);
  return NextResponse.json({ ...consentStatus(user.id, CONSENT_VERSION), currentVersion: CONSENT_VERSION });
}
