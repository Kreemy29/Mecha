import fs from "fs";
import path from "path";

// ── RunningHub OpenAPI client ──
// Wraps the three calls we need for the Wan Animate "character replacement"
// AI App: upload a file, submit a run, and poll the task to completion.
//
// Flow per animate job:
//   1. uploadBinary(image)  → fileValue   (the recreated/approved still)
//   2. uploadBinary(video)  → fileValue   (the original driving video)
//   3. submitWanAnimate({ image, video, seconds }) → taskId
//   4. queryTask(taskId) until SUCCESS → results[].url   (valid only 24h!)

const BASE = "https://www.runninghub.ai/openapi/v2";

function apiKey(): string {
  const key = process.env.RUNNINGHUB_API_KEY;
  if (!key) {
    throw new Error(
      "RUNNINGHUB_API_KEY is not set — add it to .env.local to use Wan Animate"
    );
  }
  return key;
}

// The published Wan Animate app + its node IDs. Overridable via env, but the
// defaults match the "Wan Animate character replacement V3" app.
function config() {
  return {
    appId: process.env.RUNNINGHUB_WAN_APP_ID || "1989231732442402818",
    imageNodeId: process.env.RUNNINGHUB_WAN_IMAGE_NODE || "149",
    videoNodeId: process.env.RUNNINGHUB_WAN_VIDEO_NODE || "172",
    secondsNodeId: process.env.RUNNINGHUB_WAN_SECONDS_NODE || "154",
    instanceType: process.env.RUNNINGHUB_INSTANCE_TYPE || "default",
  };
}

function authHeaders(): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey()}`,
  };
}

// ── 1. Upload a local file, get back the server-side file value ──
// The returned `download_url` (e.g. "abc123.mp4") is what RunningHub expects
// as a node `fieldValue`. Uploaded files are valid for ~24h.
export async function uploadBinary(localPath: string): Promise<string> {
  const abs = path.resolve(localPath);
  if (!fs.existsSync(abs)) {
    throw new Error(`RunningHub upload: file not found: ${abs}`);
  }

  const buffer = fs.readFileSync(abs);
  const form = new FormData();
  form.append(
    "file",
    new Blob([buffer]),
    path.basename(abs)
  );

  const res = await fetch(`${BASE}/media/upload/binary`, {
    method: "POST",
    headers: authHeaders(),
    body: form,
  });

  if (!res.ok) {
    throw new Error(
      `RunningHub upload failed (${res.status}): ${await res.text()}`
    );
  }

  const json = await res.json();
  if (json.code !== 0 || !json.data?.download_url) {
    throw new Error(
      `RunningHub upload returned no file value: ${JSON.stringify(json).slice(0, 300)}`
    );
  }
  return json.data.download_url as string;
}

// ── 2. Submit a Wan Animate run ──
export interface WanAnimateSubmit {
  imageFileValue: string; // from uploadBinary(approvedImage)
  videoFileValue: string; // from uploadBinary(originalVideo)
  seconds?: number; // animation duration; defaults to the app's value
}

export async function submitWanAnimate(
  input: WanAnimateSubmit
): Promise<string> {
  const cfg = config();

  const nodeInfoList: Array<Record<string, string>> = [
    {
      nodeId: cfg.imageNodeId,
      fieldName: "image",
      fieldValue: input.imageFileValue,
      description: "Upload image",
    },
    {
      nodeId: cfg.videoNodeId,
      fieldName: "video",
      fieldValue: input.videoFileValue,
      description: "Upload video",
    },
  ];

  if (input.seconds != null) {
    nodeInfoList.push({
      nodeId: cfg.secondsNodeId,
      fieldName: "value",
      fieldValue: String(input.seconds),
      description: "Adjust seconds",
    });
  }

  const res = await fetch(`${BASE}/run/ai-app/${cfg.appId}`, {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({
      nodeInfoList,
      instanceType: cfg.instanceType,
      usePersonalQueue: "false",
    }),
  });

  if (!res.ok) {
    throw new Error(
      `RunningHub submit failed (${res.status}): ${await res.text()}`
    );
  }

  const json = await res.json();
  if (json.errorCode || !json.taskId) {
    throw new Error(
      `RunningHub submit error: ${json.errorMessage || JSON.stringify(json).slice(0, 300)}`
    );
  }
  return json.taskId as string;
}

// ── 3. Poll a task ──
export interface WanAnimateStatus {
  status: "running" | "succeeded" | "failed";
  outputUrl?: string;
  outputType?: string;
  error?: string;
}

export async function queryTask(taskId: string): Promise<WanAnimateStatus> {
  const res = await fetch(`${BASE}/query`, {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ taskId }),
  });

  if (!res.ok) {
    throw new Error(
      `RunningHub query failed (${res.status}): ${await res.text()}`
    );
  }

  const json = await res.json();
  const status: string = json.status;

  if (status === "SUCCESS") {
    // Prefer a video output; fall back to the first result.
    const results: Array<{ url?: string; outputType?: string }> =
      json.results || [];
    const video = results.find((r) => r.outputType === "mp4") || results[0];
    if (!video?.url) {
      return { status: "failed", error: "Task succeeded but returned no output URL" };
    }
    return {
      status: "succeeded",
      outputUrl: video.url,
      outputType: video.outputType || "mp4",
    };
  }

  if (status === "FAILED") {
    return {
      status: "failed",
      error:
        json.errorMessage ||
        (json.failedReason && JSON.stringify(json.failedReason)) ||
        "RunningHub task failed",
    };
  }

  // QUEUED / RUNNING
  return { status: "running" };
}
