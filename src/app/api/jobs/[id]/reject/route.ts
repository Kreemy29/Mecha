import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { eq } from "drizzle-orm";
import { rewritePromptWithNotes } from "@/lib/services/grok";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { rejectionNotes } = await request.json();

  if (!rejectionNotes?.trim()) {
    return NextResponse.json(
      { error: "rejectionNotes are required" },
      { status: 400 }
    );
  }

  const job = db
    .select()
    .from(schema.jobs)
    .where(eq(schema.jobs.id, parseInt(id)))
    .get();

  if (!job) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  // Get the character profile for identity preservation
  let characterProfile = "";
  if (job.characterId) {
    const character = db
      .select()
      .from(schema.characters)
      .where(eq(schema.characters.id, job.characterId))
      .get();
    characterProfile = character?.featureProfile || "";
  }

  // Append to prompt history
  const history = (job.promptHistory as Array<{
    prompt: string;
    outputPath?: string;
    rejectionNote?: string;
    timestamp: string;
  }>) || [];

  history.push({
    prompt: job.prompt || "",
    outputPath: job.outputPath || undefined,
    rejectionNote: rejectionNotes,
    timestamp: new Date().toISOString(),
  });

  // Get rewritten prompt from Grok
  try {
    const newPrompt = await rewritePromptWithNotes(
      job.prompt || "",
      rejectionNotes,
      characterProfile
    );

    // Create a NEW job (not resubmitting the same one) — carry over the
    // model, params (quality/aspect/scene ref), and character so the redo
    // regenerates with the exact same settings, just an improved prompt.
    const newJob = db
      .insert(schema.jobs)
      .values({
        batchId: job.batchId,
        characterId: job.characterId,
        referenceId: job.referenceId,
        kind: job.kind,
        status: "queued",
        provider: job.provider,
        providerModel: job.providerModel,
        providerParams: job.providerParams,
        prompt: newPrompt,
        promptHistory: history,
        attempts: 0,
      })
      .returning()
      .get();

    // Mark old job as rejected
    db.update(schema.jobs)
      .set({
        status: "rejected",
        promptHistory: history,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(schema.jobs.id, parseInt(id)))
      .run();

    return NextResponse.json({
      oldJobId: parseInt(id),
      newJob,
      rewrittenPrompt: newPrompt,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
