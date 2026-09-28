import { NextRequest, NextResponse } from "next/server";
import { currentUser, requireUser, updateUser } from "@/lib/services/auth";
import { notifyUsers } from "@/lib/services/notify";

// The signed-in user's own contact details (where notifications go).
export async function GET() {
  const { user, deny } = await requireUser();
  if (deny) return deny;
  return NextResponse.json(user);
}

// { email?, telegramUsername? }
export async function PATCH(request: NextRequest) {
  const { user, deny } = await requireUser();
  if (deny) return deny;
  try {
    const { email, telegramUsername } = await request.json();
    return NextResponse.json(updateUser(user.id, { email, telegramUsername }));
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
  }
}

// Send yourself a test notification on every channel you've set up.
export async function POST() {
  const { deny } = await requireUser();
  if (deny) return deny;
  const me = await currentUser();
  if (!me) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const result = await notifyUsers("test", [me], {
    title: "Test notification from OneUp",
    lines: [`Hi ${me.name}, this is where your OneUp workflow messages will arrive.`],
  });
  return NextResponse.json(result);
}
