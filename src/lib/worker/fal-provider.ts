import type { JobProvider, ProviderSubmitResult, ProviderPollResult } from "./providers.js";
import fs from "fs";
import path from "path";

const FAL_QUEUE_URL = "https://queue.fal.run";

export interface FalModel {
  id: string;
  label: string;
  costPerImage: number;
  defaultParams?: Record<string, unknown>;
}

export const FAL_MODELS: Record<string, FalModel> = {
  "nano-banana-pro": {
    id: "fal-ai/nano-banana-pro",
    label: "Nano Banana Pro (Gemini 3 Pro)",
    costPerImage: 0.15,
    defaultParams: {
      resolution: "1K",
      output_format: "png",
      safety_tolerance: 4,
    },
  },
  "nano-banana-2": {
    id: "fal-ai/nano-banana-2",
    label: "Nano Banana 2 (Gemini 3.1 Flash)",
    costPerImage: 0.08,
    defaultParams: {
      resolution: "1K",
      output_format: "png",
      safety_tolerance: 4,
    },
  },
  "seedream-v5": {
    id: "fal-ai/bytedance/seedream/v5/lite/text-to-image",
    label: "Seedream V5 Lite (ByteDance)",
    costPerImage: 0.04,
    defaultParams: {
      output_format: "png",
    },
  },
};

function getApiKey(): string {
  const key = process.env.FAL_KEY;
  if (!key) throw new Error("FAL_KEY not configured in .env.local");
  return key;
}

export class FalProvider implements JobProvider {
  name = "fal";
  private modelKey: string;

  constructor(modelKey: string = "nano-banana-pro") {
    this.modelKey = modelKey;
  }

  private getModel(): FalModel {
    const model = FAL_MODELS[this.modelKey];
    if (!model) {
      throw new Error(
        `Unknown fal model: ${this.modelKey}. Available: ${Object.keys(FAL_MODELS).join(", ")}`
      );
    }
    return model;
  }

  async submit(job: {
    prompt: string;
    characterRef?: string | null;
    referenceImagePath?: string | null;
    referenceVideoPath?: string | null;
    kind: string;
    modelKey?: string;
  }): Promise<ProviderSubmitResult> {
    const model = this.getModel();
    const apiKey = getApiKey();

    const body: Record<string, unknown> = {
      prompt: job.prompt,
      num_images: 1,
      ...model.defaultParams,
    };

    console.log(`[FalProvider] Submitting to ${model.id}: "${job.prompt.slice(0, 80)}..."`);

    const res = await fetch(`${FAL_QUEUE_URL}/${model.id}`, {
      method: "POST",
      headers: {
        Authorization: `Key ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`fal submit error (${res.status}): ${errText}`);
    }

    const data = await res.json();
    console.log(`[FalProvider] Queued: ${data.request_id}`);

    // Store the model ID + request_id so we can poll later
    return {
      providerJobId: JSON.stringify({
        requestId: data.request_id,
        modelId: model.id,
        statusUrl: data.status_url,
        responseUrl: data.response_url,
      }),
    };
  }

  async poll(providerJobId: string): Promise<ProviderPollResult> {
    const apiKey = getApiKey();
    const { requestId, modelId, statusUrl } = JSON.parse(providerJobId);

    const url = statusUrl || `${FAL_QUEUE_URL}/${modelId}/requests/${requestId}/status`;

    const res = await fetch(url, {
      headers: {
        Authorization: `Key ${apiKey}`,
      },
    });

    if (!res.ok) {
      const errText = await res.text();
      // Check for content filter
      if (res.status === 422 || errText.toLowerCase().includes("safety") || errText.toLowerCase().includes("nsfw")) {
        return { status: "filtered", error: errText };
      }
      return { status: "failed", error: `fal poll error (${res.status}): ${errText}` };
    }

    const data = await res.json();
    console.log(`[FalProvider] Poll ${requestId}: ${data.status}`);

    switch (data.status) {
      case "IN_QUEUE":
      case "IN_PROGRESS":
        return { status: "running" };

      case "COMPLETED": {
        // Need to fetch the actual result
        const resultUrl =
          data.response_url ||
          `${FAL_QUEUE_URL}/${modelId}/requests/${requestId}`;

        const resultRes = await fetch(resultUrl, {
          headers: { Authorization: `Key ${apiKey}` },
        });

        if (!resultRes.ok) {
          return {
            status: "failed",
            error: `fal result fetch error (${resultRes.status})`,
          };
        }

        const result = await resultRes.json();

        // Check for content filter in result
        if (result.has_nsfw_concepts?.some((v: boolean) => v)) {
          return {
            status: "filtered",
            error: "Content rejected by fal safety filter",
          };
        }

        const imageUrl = result.images?.[0]?.url;
        if (!imageUrl) {
          return {
            status: "failed",
            error: "No image URL in fal response",
          };
        }

        return { status: "succeeded", outputUrl: imageUrl };
      }

      case "FAILED":
        return {
          status: "failed",
          error: data.error || "fal job failed",
        };

      default:
        return { status: "running" };
    }
  }

  async download(outputUrl: string, destPath: string): Promise<void> {
    const dir = path.dirname(destPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    console.log(`[FalProvider] Downloading ${outputUrl}`);
    const res = await fetch(outputUrl);
    if (!res.ok) {
      throw new Error(`fal download error (${res.status})`);
    }

    const buffer = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(destPath, buffer);
    console.log(`[FalProvider] Saved to ${destPath} (${buffer.length} bytes)`);
  }
}
