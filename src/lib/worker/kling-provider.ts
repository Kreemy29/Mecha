import type {
  JobProvider,
  ProviderSubmitResult,
  ProviderPollResult,
} from "./providers.js";
import {
  uploadImageToHiggsfield,
  uploadVideoToHiggsfield,
  submitMotionControlJob,
  checkJob,
} from "../services/higgsfield.js";
import fs from "fs";
import path from "path";

// Kling 3.0 Motion Control (Higgsfield `motion_control`) — the alternative to
// RunningHub's Wan Animate for the motion-capture pipeline. Same inputs as Wan
// (approved still + driving video), so the two are interchangeable per job.
//
// Unlike Seedance this tool takes NO prompt: the scene comes from whichever
// source `scene_control` names. We default to "image" so the backdrop we
// already generated into the still is what survives.
export class KlingProvider implements JobProvider {
  name = "kling";

  async submit(job: {
    prompt: string;
    referenceImagePath?: string | null;
    referenceVideoPath?: string | null;
    kind: string;
    params?: {
      quality?: string;
      resolution?: string;
      sceneControl?: string;
    } | null;
  }): Promise<ProviderSubmitResult> {
    if (!job.referenceImagePath) {
      throw new Error(
        "Kling Motion Control: missing approved still (referenceImagePath)"
      );
    }
    if (!job.referenceVideoPath) {
      throw new Error(
        "Kling Motion Control: missing driving video (referenceVideoPath)"
      );
    }

    console.log("[KlingProvider] Uploading still + video to Higgsfield...");
    const imageMediaId = await uploadImageToHiggsfield(job.referenceImagePath);
    const videoMediaId = await uploadVideoToHiggsfield(job.referenceVideoPath);

    const resolution = job.params?.resolution === "1080p" ? "1080p" : "720p";
    const sceneControl = job.params?.sceneControl === "video" ? "video" : "image";

    const { jobId } = await submitMotionControlJob({
      imageMediaId,
      videoMediaId,
      resolution,
      sceneControl,
    });
    console.log(`[KlingProvider] Submitted job ${jobId}`);
    return { providerJobId: jobId };
  }

  async poll(providerJobId: string): Promise<ProviderPollResult> {
    const r = await checkJob(providerJobId);
    console.log(`[KlingProvider] Poll ${providerJobId}: ${r.status}`);
    if (r.status === "succeeded") return { status: "succeeded", outputUrl: r.rawUrl };
    if (r.status === "filtered") return { status: "filtered", error: r.error };
    if (r.status === "failed") return { status: "failed", error: r.error };
    return { status: "running" };
  }

  async download(outputUrl: string, destPath: string): Promise<void> {
    const dir = path.dirname(destPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    console.log(`[KlingProvider] Downloading ${outputUrl}`);
    const res = await fetch(outputUrl);
    if (!res.ok) throw new Error(`Kling download error (${res.status})`);
    const buffer = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(destPath, buffer);
    console.log(`[KlingProvider] Saved to ${destPath} (${buffer.length} bytes)`);
  }
}
