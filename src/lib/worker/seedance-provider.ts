import type {
  JobProvider,
  ProviderSubmitResult,
  ProviderPollResult,
} from "./providers.js";
import {
  uploadImageToHiggsfield,
  uploadVideoToHiggsfield,
  submitVideoJob,
  checkJob,
  estimateVideoJobCost,
  getCreditsBalance,
} from "../services/higgsfield.js";
import fs from "fs";
import path from "path";

// Seedance video-to-video provider (Higgsfield generate_video).
// Uploads the approved still (@Image1) + the reference video (@Video1) as media,
// submits the Seedance job with the Grok replacement prompt, and polls it.
export class SeedanceProvider implements JobProvider {
  name = "seedance";

  async submit(job: {
    prompt: string;
    referenceImagePath?: string | null;
    referenceVideoPath?: string | null;
    kind: string;
    params?: { aspectRatio?: string; duration?: number } | null;
  }): Promise<ProviderSubmitResult> {
    if (!job.referenceImagePath) {
      throw new Error("Seedance: missing approved still (referenceImagePath)");
    }
    if (!job.referenceVideoPath) {
      throw new Error("Seedance: missing reference video (referenceVideoPath)");
    }

    console.log("[SeedanceProvider] Uploading still + video to Higgsfield...");
    const imageMediaId = await uploadImageToHiggsfield(job.referenceImagePath);
    const videoMediaId = await uploadVideoToHiggsfield(job.referenceVideoPath);

    const submitOptions = {
      imageMediaId,
      videoMediaId,
      aspectRatio: job.params?.aspectRatio || "9:16",
      duration: job.params?.duration,
    };

    // Eligibility preflight: cost vs. available credits. Fail fast with a clear
    // message instead of a cryptic provider error (skipped if either is unknown).
    const [cost, balance] = await Promise.all([
      estimateVideoJobCost(job.prompt, submitOptions),
      getCreditsBalance(),
    ]);
    if (cost != null && balance != null) {
      console.log(
        `[SeedanceProvider] Cost preflight: ${cost} credits (balance: ${balance})`
      );
      if (balance < cost) {
        throw new Error(
          `Insufficient Higgsfield credits: this generation costs ~${cost}, balance is ${balance}. Top up and retry.`
        );
      }
    } else {
      console.log(
        `[SeedanceProvider] Cost preflight unavailable (cost: ${cost}, balance: ${balance}) — proceeding`
      );
    }

    const { jobId } = await submitVideoJob(job.prompt, submitOptions);
    console.log(`[SeedanceProvider] Submitted job ${jobId}`);
    return { providerJobId: jobId };
  }

  async poll(providerJobId: string): Promise<ProviderPollResult> {
    const r = await checkJob(providerJobId);
    console.log(`[SeedanceProvider] Poll ${providerJobId}: ${r.status}`);
    if (r.status === "succeeded") return { status: "succeeded", outputUrl: r.rawUrl };
    if (r.status === "filtered") return { status: "filtered", error: r.error };
    if (r.status === "failed") return { status: "failed", error: r.error };
    return { status: "running" };
  }

  async download(outputUrl: string, destPath: string): Promise<void> {
    const dir = path.dirname(destPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    console.log(`[SeedanceProvider] Downloading ${outputUrl}`);
    const res = await fetch(outputUrl);
    if (!res.ok) throw new Error(`Seedance download error (${res.status})`);
    const buffer = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(destPath, buffer);
    console.log(`[SeedanceProvider] Saved to ${destPath} (${buffer.length} bytes)`);
  }
}
