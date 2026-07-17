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

// Higgsfield Souls have NO negative-prompt parameter — the whole prompt string is
// treated as positive text. Our recreation step emits a structured JSON that
// includes a `negative_prompt` array (for LoRA runners). Sent verbatim to
// Higgsfield, words like "tattoo" in that array become POSITIVE cues and cause
// the very artifacts we're trying to avoid. So for Higgsfield we flatten the JSON
// to clean prose, drop the negative_prompt/loras/controls entirely, strip any
// stray tattoo/ink words, and add a positive clean-skin cue.
export function toHiggsfieldPrompt(raw: string): string {
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(raw);
  } catch {
    return raw; // already plain prose
  }
  if (!obj || typeof obj !== "object" || !("subject" in obj)) return raw;

  const g = (o: unknown, k: string): string => {
    const v = (o as Record<string, unknown>)?.[k];
    if (Array.isArray(v)) return v.filter(Boolean).join(", ");
    return typeof v === "string" ? v : "";
  };
  const s = obj.subject,
    p = obj.pose,
    e = obj.environment,
    c = obj.camera,
    l = obj.lighting,
    o = obj.output;

  const parts: string[] = [];
  const subj = [g(s, "description"), g(s, "anatomy")].filter(Boolean).join(", ");
  if (subj) parts.push(subj);
  parts.push("flawless smooth clean unmarked skin"); // positive cue (no negation)
  if (g(s, "attire")) parts.push(`wearing ${g(s, "attire")}`);
  if (g(s, "accessories")) parts.push(g(s, "accessories"));
  const pose = ["type", "orientation", "expression", "arms", "legs", "spine"]
    .map((k) => g(p, k))
    .filter(Boolean)
    .join(", ");
  if (pose) parts.push(pose);
  if (g(e, "location")) parts.push(`in ${g(e, "location")}`);
  const cam = ["type", "lens", "dof"].map((k) => g(c, k)).filter(Boolean).join(", ");
  if (cam) parts.push(cam);
  const light = [g(l, "sources"), g(l, "quality")].filter(Boolean).join(", ");
  if (light) parts.push(light);
  if (g(o, "style")) parts.push(g(o, "style"));

  let out = parts.filter(Boolean).join(". ");
  // Belt-and-suspenders: remove any stray tattoo/ink references from the text.
  out = out
    .replace(/\b(tattoos?|ink|body art|markings?)\b/gi, "")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([.,])/g, "$1")
    .trim();
  return out;
}

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
      mediaRefs?: string[];
    } | null;
  }): Promise<ProviderSubmitResult> {
    const model = job.modelKey || this.modelKey;

    // soul_id only applies to soul_2 / soul_cinematic.
    const soulModels = new Set(["soul_2", "soul_cinematic"]);
    const isSoul = soulModels.has(model);
    const soulId = isSoul && job.characterRef ? job.characterRef : undefined;

    // Non-Soul models (seedream, nano-banana, gpt-image) get reference images
    // uploaded as medias. An explicit mediaRefs list wins (e.g. the background
    // swap sends [subject still, new background]); otherwise fall back to the
    // face (+ scene) refs used by the subject swap.
    const mediaRefs: string[] = [];
    if (job.params?.mediaRefs?.length) {
      mediaRefs.push(...job.params.mediaRefs);
    } else if (!isSoul) {
      if (job.faceRefUrl) mediaRefs.push(job.faceRefUrl);
      if (job.params?.sceneRefUrl) mediaRefs.push(job.params.sceneRefUrl);
    }

    console.log(
      `[HiggsfieldProvider] Submitting to ${model}${
        soulId ? ` (soul ${soulId})` : ""
      }${mediaRefs.length ? ` (+${mediaRefs.length} refs)` : ""}`
    );

    // Flatten the structured recreation JSON to clean prose (Higgsfield has no
    // negative-prompt support, so the raw JSON's negatives would backfire).
    const higgsfieldPrompt = toHiggsfieldPrompt(job.prompt);

    const { jobId } = await submitImageJob(higgsfieldPrompt, {
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
