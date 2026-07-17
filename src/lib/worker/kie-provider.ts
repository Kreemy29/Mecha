import type {
  JobProvider,
  ProviderSubmitResult,
  ProviderPollResult,
} from "./providers.js";
import {
  uploadToKie,
  createSeedanceTask,
  queryKieTask,
} from "../services/kie.js";
import { prepareVideoForKie } from "../services/references.js";
import fs from "fs";
import path from "path";

// KIE AI Seedance provider — alternate to Higgsfield's generate_video.
// Uploads the approved still + reference video to KIE's file host, creates a
// Seedance task, and polls it. Model tier (standard/fast) comes from the job's
// providerModel; the safety-checker flag comes from KIE_ENABLE_SAFETY_CHECKER.
export class KieProvider implements JobProvider {
  name = "kie";

  async submit(job: {
    prompt: string;
    referenceImagePath?: string | null;
    referenceVideoPath?: string | null;
    kind: string;
    modelKey?: string;
    params?: { aspectRatio?: string; duration?: number } | null;
  }): Promise<ProviderSubmitResult> {
    if (!job.referenceImagePath) {
      throw new Error("KIE: missing approved still (referenceImagePath)");
    }
    if (!job.referenceVideoPath) {
      throw new Error("KIE: missing reference video (referenceVideoPath)");
    }

    // Re-encode the reference video to KIE's size/duration limits first, then
    // upload both (KIE needs public URLs, not local paths).
    console.log("[KieProvider] Preparing video to KIE limits...");
    const preparedVideo = await prepareVideoForKie(job.referenceVideoPath);
    console.log("[KieProvider] Uploading still + video to KIE...");
    const imageUrl = await uploadToKie(job.referenceImagePath);
    const videoUrl = await uploadToKie(preparedVideo);

    const taskId = await createSeedanceTask({
      prompt: job.prompt,
      imageUrl,
      videoUrl,
      aspectRatio: job.params?.aspectRatio || "9:16",
      duration: job.params?.duration,
      fast: job.modelKey === "fast",
    });
    return { providerJobId: taskId };
  }

  async poll(providerJobId: string): Promise<ProviderPollResult> {
    const r = await queryKieTask(providerJobId);
    console.log(`[KieProvider] Poll ${providerJobId}: ${r.status}`);
    if (r.status === "succeeded") return { status: "succeeded", outputUrl: r.outputUrl };
    if (r.status === "failed") return { status: "failed", error: r.error };
    return { status: "running" };
  }

  async download(outputUrl: string, destPath: string): Promise<void> {
    const dir = path.dirname(destPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    console.log(`[KieProvider] Downloading ${outputUrl}`);
    const res = await fetch(outputUrl);
    if (!res.ok) throw new Error(`KIE download error (${res.status})`);
    const buffer = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(destPath, buffer);
    console.log(`[KieProvider] Saved to ${destPath} (${buffer.length} bytes)`);
  }
}
