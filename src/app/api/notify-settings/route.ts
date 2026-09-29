import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/services/auth";
import { publicOrigin } from "@/lib/request-origin";
import {
  CREDENTIAL_KEYS,
  credentialStatus,
  setCredential,
  setupTelegramWebhook,
  telegramBotUsername,
  type CredentialKey,
} from "@/lib/services/notify";

// Admin-only: the bot token and Gmail login, saved in the app. GET returns a
// masked view only; values never come back out.
export async function GET() {
  const { deny } = await requireUser({ admin: true });
  if (deny) return deny;
  return NextResponse.json(credentialStatus());
}

// { telegramBotToken?, gmailUser?, gmailAppPassword? } — a string saves it,
// "" or null clears it. Saving a bot token also points the bot at this app.
export async function POST(request: NextRequest) {
  const { deny } = await requireUser({ admin: true });
  if (deny) return deny;
  const body = (await request.json()) as Partial<Record<CredentialKey, string | null>>;

  try {
    for (const k of Object.keys(CREDENTIAL_KEYS) as CredentialKey[]) {
      if (!(k in body)) continue;
      const v = body[k];
      if (k === "telegramBotToken" && v && !/^\d{5,}:[A-Za-z0-9_-]{30,}$/.test(v.trim())) {
        return NextResponse.json({ error: "That doesn't look like a bot token (123456:ABC...)" }, { status: 400 });
      }
      if (k === "gmailUser" && v && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim())) {
        return NextResponse.json({ error: "Enter the full Gmail / Workspace address" }, { status: 400 });
      }
      setCredential(k, v ?? null);
    }

    let webhook: string | null = null;
    if (body.telegramBotToken) {
      // Check the token is real (getMe), then connect the webhook straight away.
      try {
        await telegramBotUsername();
      } catch (err) {
        setCredential("telegramBotToken", null);
        throw new Error(`Telegram rejected that token: ${err instanceof Error ? err.message : String(err)}`);
      }
      const origin = process.env.APP_URL?.replace(/\/$/, "") || publicOrigin(request);
      if (origin.startsWith("https://")) webhook = await setupTelegramWebhook(origin);
    }
    return NextResponse.json({ ok: true, webhook, status: credentialStatus() });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
  }
}
