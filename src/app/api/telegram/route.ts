import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/services/auth";
import { publicOrigin } from "@/lib/request-origin";
import {
  notifyConfig,
  setupTelegramWebhook,
  telegramBotUsername,
  telegramConnectLink,
} from "@/lib/services/notify";

// GET                     → is the bot configured, and what's its @name
// POST { action: "connect" } → a one-time t.me link for the signed-in user
// POST { action: "setup" }   → (admin) point Telegram at this app's webhook
export async function GET() {
  const { deny } = await requireUser();
  if (deny) return deny;
  let bot: string | null = null;
  try {
    bot = await telegramBotUsername();
  } catch {
    // bad token: reported as not configured below
  }
  return NextResponse.json({ ...notifyConfig(), bot });
}

export async function POST(request: NextRequest) {
  const { user, deny } = await requireUser();
  if (deny) return deny;
  const { action } = await request.json();
  try {
    if (action === "connect") {
      return NextResponse.json({ url: await telegramConnectLink(user.id) });
    }
    if (action === "setup") {
      if (!user.isAdmin) return NextResponse.json({ error: "Admins only" }, { status: 403 });
      const origin = process.env.APP_URL?.replace(/\/$/, "") || publicOrigin(request);
      if (!origin.startsWith("https://")) {
        return NextResponse.json(
          { error: `Telegram needs a public https address; this app is at ${origin}. Run this on the live site.` },
          { status: 400 }
        );
      }
      return NextResponse.json({ webhook: await setupTelegramWebhook(origin) });
    }
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
  }
}
