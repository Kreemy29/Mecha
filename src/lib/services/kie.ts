import fs from "fs";
import path from "path";

// ── KIE AI client (Seedance video generation) ──
// KIE uses a unified async "Jobs" API: createTask → recordInfo poll → result
// URLs. Media inputs must be public URLs, so we upload the local still + video
// to KIE's file host first. Uncertain field names are env-overridable and the
// raw responses are dumped to ./data/debug-kie-*.json for quick correction.

const BASE = () => process.env.KIE_BASE_URL || "https://api.kie.ai";
const UPLOAD = () =>
  process.env.KIE_UPLOAD_URL || "https://kieai.redpandaai.co";

function apiKey(): string {
  const k = process.env.KIE_API_KEY;
  if (!k) throw new Error("KIE_API_KEY is not set — add it to .env.local");
  return k;
}
function authHeaders(): Record<string, string> {
  return { Authorization: `Bearer ${apiKey()}` };
}

function dump(name: string, data: unknown) {
  try {
    fs.writeFileSync(`./data/debug-kie-${name}.json`, JSON.stringify(data, null, 2));
  } catch {
    // non-fatal
  }
}

// ── Upload a local file, get a public URL KIE can fetch ──
export async function uploadToKie(localPath: string): Promise<string> {
  const abs = path.resolve(localPath);
  if (!fs.existsSync(abs)) throw new Error(`KIE upload: file not found: ${abs}`);

  const buffer = fs.readFileSync(abs);
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(buffer)]), path.basename(abs));
  form.append("uploadPath", "mecha-ai");

  const res = await fetch(`${UPLOAD()}/api/file-stream-upload`, {
    method: "POST",
    headers: authHeaders(),
    body: form,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`KIE upload failed (${res.status}): ${JSON.stringify(json).slice(0, 300)}`);
  }
  const url =
    json?.data?.downloadUrl || json?.data?.url || json?.downloadUrl || json?.url;
  if (!url) {
    dump("upload", json);
    throw new Error(`KIE upload returned no URL: ${JSON.stringify(json).slice(0, 300)}`);
  }
  return url as string;
}

// ── Create a Seedance task ──
export interface KieSeedanceInput {
  prompt: string;
  imageUrl: string;
  videoUrl: string;
  aspectRatio?: string;
  duration?: number;
  fast?: boolean;
}

// KIE's Seedance is Multimodal Reference-to-Video: structured reference image +
// video, plus a plain-language prompt. The recreation prompt is authored for
// Higgsfield's @Image1/@Video1 element tags (meaningless to KIE), so rewrite it
// to reference "the reference image / video" and drop the DEFINE lines.
function toKiePrompt(raw: string): string {
  return raw
    .replace(/^\s*DEFINE the woman in @\S+ as ".*?"\.?\s*$/gim, "")
    // Higgsfield linked-element syntax: @[Image 1](image_1) / @[Video 1](video_1)
    .replace(/@\[Image\s*\d*\]\(image_\d*\)/gi, "the subject in the reference image")
    .replace(/@\[Video\s*\d*\]\(video_\d*\)/gi, "the reference video")
    // Older bare-tag form
    .replace(/@Image\d*/g, "the subject in the reference image")
    .replace(/@Video\d*/g, "the reference video")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export async function createSeedanceTask(input: KieSeedanceInput): Promise<string> {
  const model = input.fast
    ? process.env.KIE_SEEDANCE_FAST_MODEL || "bytedance/seedance-2-fast"
    : process.env.KIE_SEEDANCE_MODEL || "bytedance/seedance-2";

  // nsfw_checker: true = KIE content filtering ON; false = OFF (disabled).
  const nsfwChecker =
    (process.env.KIE_ENABLE_SAFETY_CHECKER || "false").toLowerCase() === "true";

  const body = {
    model,
    input: {
      prompt: toKiePrompt(input.prompt),
      // Multimodal Reference-to-Video: identity image + motion/scene video.
      reference_image_urls: [input.imageUrl],
      reference_video_urls: [input.videoUrl],
      aspect_ratio: input.aspectRatio || "9:16",
      resolution: process.env.KIE_RESOLUTION || "720p",
      duration: Math.min(15, Math.max(4, Math.round(input.duration || 5))),
      generate_audio: false,
      nsfw_checker: nsfwChecker,
    },
  };

  const res = await fetch(`${BASE()}/api/v1/jobs/createTask`, {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || (json.code && json.code !== 200)) {
    dump("createTask", { body, json });
    throw new Error(
      `KIE createTask failed (${res.status}/${json.code}): ${json.message || JSON.stringify(json).slice(0, 300)}`
    );
  }
  const taskId = json?.data?.taskId || json?.data?.id || json?.taskId;
  if (!taskId) {
    dump("createTask", { body, json });
    throw new Error(`KIE createTask returned no taskId: ${JSON.stringify(json).slice(0, 300)}`);
  }
  console.log(`[KIE] Created task ${taskId} (${model}, nsfw_checker=${nsfwChecker})`);
  return taskId as string;
}

// ── Poll a task ──
export interface KieStatus {
  status: "running" | "succeeded" | "failed";
  outputUrl?: string;
  error?: string;
}

export async function queryKieTask(taskId: string): Promise<KieStatus> {
  const res = await fetch(
    `${BASE()}/api/v1/jobs/recordInfo?taskId=${encodeURIComponent(taskId)}`,
    { headers: authHeaders() }
  );
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    return { status: "failed", error: `KIE query failed (${res.status})` };
  }

  const data = json?.data || {};
  // KIE state machine: waiting / queuing / generating / success / fail.
  const state = String(data.state || data.status || "").toLowerCase();

  if (state === "success" || state === "succeeded") {
    let urls: string[] = [];
    try {
      const parsed =
        typeof data.resultJson === "string"
          ? JSON.parse(data.resultJson)
          : data.resultJson || {};
      urls = parsed.resultUrls || parsed.urls || parsed.output || [];
    } catch {
      // fall through
    }
    if ((!urls || urls.length === 0) && data.resultUrls) urls = data.resultUrls;
    const url = Array.isArray(urls) ? urls[0] : urls;
    if (!url) {
      dump("recordInfo", json);
      return { status: "failed", error: "KIE succeeded but returned no output URL" };
    }
    return { status: "succeeded", outputUrl: String(url) };
  }

  if (state === "fail" || state === "failed" || state === "error") {
    return {
      status: "failed",
      error: data.failMsg || data.failCode || "KIE task failed",
    };
  }

  return { status: "running" };
}
