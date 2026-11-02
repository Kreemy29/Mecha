import { db, schema } from "../db/index.js";
import { eq, inArray } from "drizzle-orm";
import { getProvider, registerProvider } from "./providers.js";
import { FalProvider } from "./fal-provider.js";
import { HiggsfieldProvider } from "./higgsfield-provider.js";
import {
  disconnectHiggsField,
  HIGGSFIELD_SIGNED_OUT,
  isHiggsfieldAuthError,
} from "../services/higgsfield.js";
import { saveOutput as saveDriveOutput } from "../services/google-drive.js";
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

// Images page jobs that picked a Drive: file the output under
// outputs/<model>/<date>/ there, and note where (or why not) on the job.
async function copyToDrive(jobId: number, outputPath: string): Promise<void> {
  const params = getJob(jobId)?.providerParams;
  const target = params?.drive;
  if (!params || !target) return;
  let driveUpload: NonNullable<typeof params.driveUpload>;
  try {
    const ext = path.extname(outputPath) || ".png";
    const saved = await saveDriveOutput({
      rootId: target.rootId,
      model: target.model,
      date: target.date,
      filePath: outputPath,
      fileName: `${target.model} ${target.date} #${jobId}${ext}`,
    });
    driveUpload = { ok: true, url: saved.url ?? undefined, folder: saved.folder, at: new Date().toISOString() };
    console.log(`[JobRunner] Job ${jobId} saved to Drive: ${target.rootName ?? target.rootId}/${saved.folder}`);
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    driveUpload = { ok: false, error, at: new Date().toISOString() };
    console.error(`[JobRunner] Job ${jobId} Drive copy failed:`, error);
  }
  // Re-read: the job may have been approved meanwhile.
  const latest = getJob(jobId)?.providerParams ?? params;
  db.update(schema.jobs)
    .set({ providerParams: { ...latest, driveUpload } })
    .where(eq(schema.jobs.id, jobId))
    .run();
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
        // After the job is marked done, so the image shows up straight away
        // and a Drive hiccup never fails a paid-for generation.
        if (job.providerParams?.drive) await copyToDrive(jobId, outputPath);
        return;
      }

      break;
    }
  } catch (err: unknown) {
    const rawMsg = err instanceof Error ? err.message : String(err);
    // A rejected Higgsfield login won't fix itself between retries: fail now
    // and say how to fix it, and drop the dead connection so the next job
    // reconnects with whatever token is on file then.
    const authFailed = isHiggsfieldAuthError(rawMsg);
    if (authFailed) disconnectHiggsField();
    const errorMsg = authFailed ? HIGGSFIELD_SIGNED_OUT : rawMsg;
    const currentJob = getJob(jobId);
    const attempts = (currentJob?.attempts || 0) + 1;

    if (attempts < MAX_ATTEMPTS && !authFailed) {
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
