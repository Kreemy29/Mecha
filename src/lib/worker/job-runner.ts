import { db, schema } from "../db/index.js";
import { eq, inArray } from "drizzle-orm";
import { getProvider, registerProvider } from "./providers.js";
import { FalProvider } from "./fal-provider.js";
import { HiggsfieldProvider } from "./higgsfield-provider.js";
import path from "path";

const POLL_INTERVAL_MS = 3000;
const MAX_POLL_BACKOFF_MS = 30000;
const MAX_ATTEMPTS = 3;
// Safety net: no provider job legitimately renders this long. Prevents a bogus
// provider id (or a hung provider) from wedging a queue slot forever.
const MAX_POLL_MS = 45 * 60 * 1000;

function getJob(jobId: number) {
  return db
    .select()
    .from(schema.jobs)
    .where(eq(schema.jobs.id, jobId))
    .get();
}

// Look up a character's Higgsfield soul_id + face image in one query.
function getCharacterRefs(characterId: number | null): {
  soulId: string | null;
  faceUrl: string | null;
} {
  if (!characterId) return { soulId: null, faceUrl: null };
  const character = db
    .select()
    .from(schema.characters)
    .where(eq(schema.characters.id, characterId))
    .get();
  return {
    soulId: character?.higgsFieldCharacterRef || null,
    faceUrl: character?.baseImagePath || null,
  };
}

function resolveProvider(providerName: string, modelKey?: string | null) {
  if (providerName === "fal" && modelKey) {
    const key = `fal:${modelKey}`;
    try {
      return getProvider(key);
    } catch {
      const provider = new FalProvider(modelKey);
      provider.name = key;
      registerProvider(provider);
      return provider;
    }
  }
  if (providerName === "higgsfield") {
    const key = modelKey ? `higgsfield:${modelKey}` : "higgsfield";
    try {
      return getProvider(key);
    } catch {
      const provider = new HiggsfieldProvider(modelKey || "soul_2");
      provider.name = key;
      registerProvider(provider);
      return provider;
    }
  }
  return getProvider(providerName);
}

export async function processJob(jobId: number): Promise<void> {
  const job = getJob(jobId);
  if (!job) {
    console.error(`[JobRunner] Job ${jobId} not found`);
    return;
  }

  if (job.status !== "queued") {
    console.log(`[JobRunner] Job ${jobId} status is ${job.status}, skipping`);
    return;
  }

  const providerName = job.provider || "dummy";
  const provider = resolveProvider(providerName, job.providerModel);

  db.update(schema.jobs)
    .set({ status: "running", updatedAt: new Date().toISOString() })
    .where(eq(schema.jobs.id, jobId))
    .run();

  const refs = getCharacterRefs(job.characterId);

  try {
    const { providerJobId } = await provider.submit({
      prompt: job.prompt || "",
      characterRef: refs.soulId,
      faceRefUrl: refs.faceUrl,
      // Wan Animate (runninghub) + Seedance (higgsfield) jobs carry their
      // image/video inputs in providerParams.
      referenceImagePath:
        job.providerParams?.animateImagePath ||
        job.providerParams?.seedanceImagePath ||
        null,
      referenceVideoPath:
        job.providerParams?.animateVideoPath ||
        job.providerParams?.seedanceVideoPath ||
        null,
      kind: job.kind,
      modelKey: job.providerModel || undefined,
      params: job.providerParams || undefined,
    });

    db.update(schema.jobs)
      .set({
        providerJobId,
        status: "polling",
        updatedAt: new Date().toISOString(),
      })
      .where(eq(schema.jobs.id, jobId))
      .run();

    let pollInterval = POLL_INTERVAL_MS;
    const pollStart = Date.now();
    while (true) {
      await sleep(pollInterval);

      if (Date.now() - pollStart > MAX_POLL_MS) {
        db.update(schema.jobs)
          .set({
            status: "failed",
            error: `Poll timeout after ${Math.round(MAX_POLL_MS / 60000)} min — provider job ${providerJobId} never reached a terminal state`,
            updatedAt: new Date().toISOString(),
          })
          .where(eq(schema.jobs.id, jobId))
          .run();
        return;
      }

      const result = await provider.poll(providerJobId);

      if (result.status === "running") {
        pollInterval = Math.min(pollInterval * 1.5, MAX_POLL_BACKOFF_MS);
        continue;
      }

      if (result.status === "filtered") {
        // Seedance: NSFW filter refunds credits — auto-regenerate (unlimited)
        // until a video succeeds. Re-queue (no recursion) so the poller retries.
        if (job.kind === "seedance") {
          const attempts = (getJob(jobId)?.attempts || 0) + 1;
          console.log(
            `[JobRunner] Seedance job ${jobId} NSFW-filtered — auto-regenerating (attempt ${attempts})`
          );
          db.update(schema.jobs)
            .set({
              status: "queued",
              attempts,
              error: `NSFW-filtered ${attempts}× — regenerating`,
              providerJobId: null,
              updatedAt: new Date().toISOString(),
            })
            .where(eq(schema.jobs.id, jobId))
            .run();
          await sleep(4000);
          return;
        }
        db.update(schema.jobs)
          .set({
            status: "filtered",
            error: "Content rejected by provider safety filter",
            updatedAt: new Date().toISOString(),
          })
          .where(eq(schema.jobs.id, jobId))
          .run();
        return;
      }

      if (result.status === "failed") {
        const currentJob = getJob(jobId);
        const attempts = (currentJob?.attempts || 0) + 1;

        if (attempts < MAX_ATTEMPTS) {
          db.update(schema.jobs)
            .set({
              status: "queued",
              attempts,
              error: result.error || "Provider error",
              updatedAt: new Date().toISOString(),
            })
            .where(eq(schema.jobs.id, jobId))
            .run();
          return processJob(jobId);
        }

        db.update(schema.jobs)
          .set({
            status: "failed",
            attempts,
            error: result.error || "Provider error after max retries",
            updatedAt: new Date().toISOString(),
          })
          .where(eq(schema.jobs.id, jobId))
          .run();
        return;
      }

      if (result.status === "succeeded" && result.outputUrl) {
        const outputDir = path.resolve("./storage/output");
        const ext = result.outputUrl.includes(".mp4") ? ".mp4" : ".png";
        const outputPath = path.join(outputDir, `${jobId}_${Date.now()}${ext}`);

        await provider.download(result.outputUrl, outputPath);

        const relativePath = path.relative(process.cwd(), outputPath);
        db.update(schema.jobs)
          .set({
            status: "succeeded",
            outputPath: relativePath,
            updatedAt: new Date().toISOString(),
          })
          .where(eq(schema.jobs.id, jobId))
          .run();
        return;
      }

      break;
    }
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    const currentJob = getJob(jobId);
    const attempts = (currentJob?.attempts || 0) + 1;

    if (attempts < MAX_ATTEMPTS) {
      db.update(schema.jobs)
        .set({
          status: "queued",
          attempts,
          error: errorMsg,
          updatedAt: new Date().toISOString(),
        })
        .where(eq(schema.jobs.id, jobId))
        .run();
      const backoff = Math.pow(2, attempts) * 1000;
      await sleep(backoff);
      return processJob(jobId);
    }

    db.update(schema.jobs)
      .set({
        status: "failed",
        attempts,
        error: errorMsg,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(schema.jobs.id, jobId))
      .run();
  }
}

export function findResumableJobs(): number[] {
  const resumable = db
    .select({ id: schema.jobs.id })
    .from(schema.jobs)
    .where(inArray(schema.jobs.status, ["running", "polling"]))
    .all();
  return resumable.map((j) => j.id);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
