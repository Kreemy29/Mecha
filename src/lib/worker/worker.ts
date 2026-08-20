import dotenv from "dotenv";
// Next.js loads .env.local automatically, but this standalone worker must load it explicitly.
dotenv.config({ path: ".env.local" });
dotenv.config(); // fall back to .env for anything not in .env.local
import { db, schema } from "../db/index.js";
import { eq } from "drizzle-orm";
import { processJob, findResumableJobs } from "./job-runner.js";
import { registerProvider } from "./providers.js";
import { FalProvider } from "./fal-provider.js";
import { HiggsfieldProvider } from "./higgsfield-provider.js";
import { RunningHubProvider } from "./runninghub-provider.js";
import { SeedanceProvider } from "./seedance-provider.js";
import { KieProvider } from "./kie-provider.js";
import { KlingProvider } from "./kling-provider.js";

const QUEUE_POLL_INTERVAL = 2000;

let imageQueue: InstanceType<typeof import("p-queue").default>;
let videoQueue: InstanceType<typeof import("p-queue").default>;

const activeJobIds = new Set<number>();

async function initQueues() {
  const PQueue = (await import("p-queue")).default;
  const imageConcurrency = parseInt(process.env.IMAGE_CONCURRENCY || "20");
  const videoConcurrency = parseInt(process.env.VIDEO_CONCURRENCY || "5");
  imageQueue = new PQueue({ concurrency: imageConcurrency });
  videoQueue = new PQueue({ concurrency: videoConcurrency });
  console.log(
    `[Worker] Queues initialized — images: ${imageConcurrency}, videos: ${videoConcurrency}`
  );
}

function getQueue(kind: string) {
  return kind === "image" ? imageQueue : videoQueue;
}

function enqueueJob(jobId: number, kind: string) {
  if (activeJobIds.has(jobId)) return;
  activeJobIds.add(jobId);
  const queue = getQueue(kind);
  queue.add(async () => {
    try {
      await processJob(jobId);
    } finally {
      activeJobIds.delete(jobId);
    }
  });
}

async function resumeInterruptedJobs() {
  const resumableIds = findResumableJobs();
  if (resumableIds.length > 0) {
    console.log(
      `[Worker] Resuming ${resumableIds.length} interrupted jobs: ${resumableIds.join(", ")}`
    );
    for (const id of resumableIds) {
      const job = db
        .select()
        .from(schema.jobs)
        .where(eq(schema.jobs.id, id))
        .get();
      if (job) {
        db.update(schema.jobs)
          .set({ status: "queued", updatedAt: new Date().toISOString() })
          .where(eq(schema.jobs.id, id))
          .run();
        enqueueJob(id, job.kind);
      }
    }
  }
}

function pollForNewJobs() {
  const queuedJobs = db
    .select()
    .from(schema.jobs)
    .where(eq(schema.jobs.status, "queued"))
    .all();

  for (const job of queuedJobs) {
    enqueueJob(job.id, job.kind);
  }
}

async function main() {
  console.log("[Worker] Starting mecha-ai worker...");

  // Register default provider instances. Model-specific instances are created
  // lazily per-job in the job runner (e.g. "higgsfield:soul_2", "fal:nano-banana-2").
  registerProvider(new FalProvider("nano-banana-pro"));
  registerProvider(new HiggsfieldProvider("soul_2"));
  registerProvider(new RunningHubProvider());
  registerProvider(new SeedanceProvider());
  registerProvider(new KieProvider());
  registerProvider(new KlingProvider());

  await initQueues();
  await resumeInterruptedJobs();

  console.log(`[Worker] Polling for new jobs every ${QUEUE_POLL_INTERVAL}ms`);
  setInterval(pollForNewJobs, QUEUE_POLL_INTERVAL);
}

main().catch((err) => {
  console.error("[Worker] Fatal error:", err);
  process.exit(1);
});
