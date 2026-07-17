import type {
  JobProvider,
  ProviderSubmitResult,
  ProviderPollResult,
} from "./providers.js";
import {
  uploadBinary,
  submitWanAnimate,
  queryTask,
} from "../services/runninghub.js";
import fs from "fs";
import path from "path";

// RunningHub provider — drives the Wan Animate "character replacement" AI App.
// Takes the approved recreated still (referenceImagePath) + the original driving
// video (referenceVideoPath), uploads both, submits the run, and polls the task.
export class RunningHubProvider implements JobProvider {
  name = "runninghub";

  async submit(job: {
    prompt: string;
    referenceImagePath?: string | null;
    referenceVideoPath?: string | null;
    kind: string;
    params?: {
      quality?: string;
      aspectRatio?: string;
      enhancePrompt?: boolean;
      sceneRefUrl?: string;
      seconds?: number;
    } | null;
  }): Promise<ProviderSubmitResult> {
    if (!job.referenceImagePath) {
      throw new Error(
        "RunningHub (Wan Animate): missing approved image (referenceImagePath)"
      );
    }
    if (!job.referenceVideoPath) {
      throw new Error(
        "RunningHub (Wan Animate): missing driving video (referenceVideoPath)"
      );
    }

    console.log(
      `[RunningHubProvider] Uploading image + video for Wan Animate...`
    );
    const imageFileValue = await uploadBinary(job.referenceImagePath);
    const videoFileValue = await uploadBinary(job.referenceVideoPath);

    const seconds = job.params?.seconds;
    const taskId = await submitWanAnimate({
      imageFileValue,
      videoFileValue,
      seconds,
    });

    console.log(`[RunningHubProvider] Submitted task ${taskId}`);
    return { providerJobId: taskId };
  }

  async poll(providerJobId: string): Promise<ProviderPollResult> {
    const result = await queryTask(providerJobId);
    console.log(`[RunningHubProvider] Poll ${providerJobId}: ${result.status}`);

    if (result.status === "succeeded") {
      return { status: "succeeded", outputUrl: result.outputUrl };
    }
    if (result.status === "failed") {
      return { status: "failed", error: result.error };
    }
    return { status: "running" };
  }

  async download(outputUrl: string, destPath: string): Promise<void> {
    const dir = path.dirname(destPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    // RunningHub result URLs expire after 24h — download immediately.
    console.log(`[RunningHubProvider] Downloading ${outputUrl}`);
    const res = await fetch(outputUrl);
    if (!res.ok) throw new Error(`RunningHub download error (${res.status})`);

    const buffer = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(destPath, buffer);
    console.log(
      `[RunningHubProvider] Saved to ${destPath} (${buffer.length} bytes)`
    );
  }
}
