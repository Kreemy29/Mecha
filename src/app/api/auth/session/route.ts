import { NextResponse } from "next/server";
import { currentUser, userCount } from "@/lib/services/auth";

// Who am I, and does this install have any accounts yet? The login screen uses
// `needsSetup` to decide between "sign in" and "create the first account".
export async function GET() {
  const user = await currentUser();
  return NextResponse.json({
    user,
    needsSetup: userCount() === 0,
    // Tells the first-run form whether to ask for the setup code. The code
    // itself never leaves the server.
    needsSetupToken: !!process.env.SETUP_TOKEN,
  });
}
