import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { handleTelegramUpdate, telegramWebhookSecret } from "@/lib/services/notify";

// Telegram calls this for every message sent to the bot. Public in proxy.ts;
// Telegram proves it's them with the secret we gave it in setWebhook.
export async function POST(request: NextRequest) {
  const got = request.headers.get("x-telegram-bot-api-secret-token") || "";
  const want = telegramWebhookSecret();
  const ok =
    got.length === want.length && crypto.timingSafeEqual(Buffer.from(got), Buffer.from(want));
  if (!ok) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  try {
    await handleTelegramUpdate(await request.json());
  } catch {
    // Always 200: a non-2xx makes Telegram retry the same update forever.
  }
  return NextResponse.json({ ok: true });
}
