import { NextResponse } from "next/server";
import { requireUser } from "@/lib/services/auth";

// Admin-only: which deploy is answering, and which settings it can see.
// Values are never returned, only whether each is set and its length, so a
// dashboard value that never reached the running app shows up as "missing".
const KEYS = [
  "TELEGRAM_BOT_TOKEN",
  "GMAIL_USER",
  "GMAIL_APP_PASSWORD",
  "APP_URL",
  "SETUP_TOKEN",
  "DATABASE_PATH",
];

const startedAt = new Date().toISOString();

export async function GET() {
  const { deny } = await requireUser({ admin: true });
  if (deny) return deny;
  return NextResponse.json({
    service: process.env.RENDER_SERVICE_NAME ?? null,
    serviceId: process.env.RENDER_SERVICE_ID ?? null,
    externalUrl: process.env.RENDER_EXTERNAL_URL ?? null,
    commit: process.env.RENDER_GIT_COMMIT?.slice(0, 7) ?? null,
    startedAt,
    env: Object.fromEntries(
      KEYS.map((k) => {
        const v = process.env[k];
        return [k, v ? { set: true, length: v.trim().length } : { set: false, length: 0 }];
      })
    ),
  });
}
