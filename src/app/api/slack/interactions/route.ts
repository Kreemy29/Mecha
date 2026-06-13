import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { db, schema } from "@/lib/db";
import { eq } from "drizzle-orm";

function verifySlackSignature(
  body: string,
  timestamp: string,
  signature: string
): boolean {
  const signingSecret = process.env.SLACK_SIGNING_SECRET;
  if (!signingSecret) return false;

  const sigBasestring = `v0:${timestamp}:${body}`;
  const mySignature = `v0=${crypto
    .createHmac("sha256", signingSecret)
    .update(sigBasestring)
    .digest("hex")}`;

  return crypto.timingSafeEqual(
    Buffer.from(mySignature),
    Buffer.from(signature)
  );
}

export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  const timestamp = request.headers.get("x-slack-request-timestamp") || "";
  const signature = request.headers.get("x-slack-signature") || "";

  // Verify signature if signing secret is configured
  if (process.env.SLACK_SIGNING_SECRET) {
    if (!verifySlackSignature(rawBody, timestamp, signature)) {
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }
  }

  const params = new URLSearchParams(rawBody);
  const payloadStr = params.get("payload");
  if (!payloadStr) {
    return NextResponse.json({ error: "No payload" }, { status: 400 });
  }

  const payload = JSON.parse(payloadStr);

  if (payload.type === "block_actions") {
    for (const action of payload.actions || []) {
      const jobId = parseInt(action.value);

      if (action.action_id === "approve_video") {
        // Set job to queued so the worker picks it up
        db.update(schema.jobs)
          .set({ status: "queued", updatedAt: new Date().toISOString() })
          .where(eq(schema.jobs.id, jobId))
          .run();

        return NextResponse.json({
          response_type: "in_channel",
          replace_original: true,
          text: `Video job #${jobId} approved and queued for generation.`,
        });
      }

      if (action.action_id === "reject_video") {
        db.update(schema.jobs)
          .set({
            status: "rejected",
            error: "Rejected via Slack",
            updatedAt: new Date().toISOString(),
          })
          .where(eq(schema.jobs.id, jobId))
          .run();

        return NextResponse.json({
          response_type: "in_channel",
          replace_original: true,
          text: `Video job #${jobId} rejected.`,
        });
      }
    }
  }

  return NextResponse.json({ ok: true });
}
