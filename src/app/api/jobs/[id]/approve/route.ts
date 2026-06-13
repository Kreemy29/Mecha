import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { eq } from "drizzle-orm";
import { postApprovedImage } from "@/lib/services/slack";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const job = db
    .select()
    .from(schema.jobs)
    .where(eq(schema.jobs.id, parseInt(id)))
    .get();

  if (!job) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  // Mark as approved
  const history = (job.promptHistory as Array<Record<string, unknown>>) || [];
  history.push({
    action: "approved",
    timestamp: new Date().toISOString(),
  });

  db.update(schema.jobs)
    .set({
      promptHistory: history,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(schema.jobs.id, parseInt(id)))
    .run();

  // Send to Slack
  let slackSent = false;
  if (job.outputPath && (process.env.SLACK_WEBHOOK_URL || process.env.SLACK_BOT_TOKEN)) {
    try {
      let characterName = "Unknown";
      if (job.characterId) {
        const character = db
          .select()
          .from(schema.characters)
          .where(eq(schema.characters.id, job.characterId))
          .get();
        characterName = character?.name || "Unknown";
      }

      await postApprovedImage(
        job.id,
        job.outputPath,
        job.prompt || "",
        characterName
      );
      slackSent = true;
    } catch (err) {
      console.error("Slack delivery failed:", err);
    }
  }

  return NextResponse.json({
    approved: true,
    jobId: parseInt(id),
    slackSent,
  });
}
