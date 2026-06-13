import type {
  JobProvider,
  ProviderSubmitResult,
  ProviderPollResult,
} from "./providers.js";
import {
  submitImageJob,
  checkJob,
} from "../services/higgsfield.js";
import fs from "fs";
import path from "path";

// Higgsfield image provider — submits via generate_image, polls via job_display
// (the "Check Job Status" tool), downloads results.rawUrl.
export class HiggsfieldProvider implements JobProvider {
  name = "higgsfield";
  private modelKey: string;

  constructor(modelKey: string = "soul_2") {
    this.modelKey = modelKey;
  }

  async submit(job: {
    prompt: string;
    characterRef?: string | null; // soul_id for trained Souls
    faceRefUrl?: string | null; // character face image (for non-Soul models)
    kind: string;
    modelKey?: string;
    params?: {
      quality?: string;
      aspectRatio?: string;
      enhancePrompt?: boolean;
      sceneRefUrl?: string;
    } | null;
  }): Promise<ProviderSubmitResult> {
    const model = job.modelKey || this.modelKey;

    // soul_id only applies to soul_2 / soul_cinematic.
    const soulModels = new Set(["soul_2", "soul_cinematic"]);
    const isSoul = soulModels.has(model);
    const soulId = isSoul && job.characterRef ? job.characterRef : undefined;

    // Non-Soul models (seedream, nano-banana, gpt-image) get the actual face
    // (and scene) reference images uploaded as medias for the subject swap.
    const mediaRefs: string[] = [];
    if (!isSoul) {
      if (job.faceRefUrl) mediaRefs.push(job.faceRefUrl);
      if (job.params?.sceneRefUrl) mediaRefs.push(job.params.sceneRefUrl);
    }

    console.log(
      `[HiggsfieldProvider] Submitting to ${model}${
        soulId ? ` (soul ${soulId})` : ""
      }${mediaRefs.length ? ` (+${mediaRefs.length} refs)` : ""}`
    );

    const { jobId } = await submitImageJob(job.prompt, {
      model,
      soulId,
      aspectRatio: job.params?.aspectRatio || "3:4",
      quality: job.params?.quality,
      enhancePrompt: job.params?.enhancePrompt,
      mediaRefs: mediaRefs.length ? mediaRefs : undefined,
    });

    return { providerJobId: jobId };
  }

  async poll(providerJobId: string): Promise<ProviderPollResult> {
    const result = await checkJob(providerJobId);
    console.log(`[HiggsfieldProvider] Poll ${providerJobId}: ${result.status}`);

    if (result.status === "succeeded") {
      return { status: "succeeded", outputUrl: result.rawUrl };
    }
    if (result.status === "filtered") {
      return { status: "filtered", error: result.error };
    }
    if (result.status === "failed") {
      return { status: "failed", error: result.error };
    }
    return { status: "running" };
  }

  async download(outputUrl: string, destPath: string): Promise<void> {
    const dir = path.dirname(destPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    console.log(`[HiggsfieldProvider] Downloading ${outputUrl}`);
    const res = await fetch(outputUrl);
    if (!res.ok) throw new Error(`Higgsfield download error (${res.status})`);

    const buffer = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(destPath, buffer);
    console.log(
      `[HiggsfieldProvider] Saved to ${destPath} (${buffer.length} bytes)`
    );
  }
}
