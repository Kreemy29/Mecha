export interface ProviderSubmitResult {
  providerJobId: string;
}

export interface ProviderPollResult {
  status: "running" | "succeeded" | "failed" | "filtered";
  outputUrl?: string;
  error?: string;
}

export interface JobProvider {
  name: string;
  submit(job: {
    prompt: string;
    characterRef?: string | null;
    faceRefUrl?: string | null;
    referenceImagePath?: string | null;
    referenceVideoPath?: string | null;
    kind: string;
    modelKey?: string;
    params?: {
      quality?: string;
      aspectRatio?: string;
      enhancePrompt?: boolean;
      sceneRefUrl?: string;
    } | null;
  }): Promise<ProviderSubmitResult>;
  poll(providerJobId: string): Promise<ProviderPollResult>;
  download(outputUrl: string, destPath: string): Promise<void>;
}

export class DummyProvider implements JobProvider {
  name = "dummy";

  async submit(job: { prompt: string }): Promise<ProviderSubmitResult> {
    const providerJobId = `dummy_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    console.log(`[DummyProvider] Submitted job ${providerJobId}: "${job.prompt}"`);
    return { providerJobId };
  }

  async poll(providerJobId: string): Promise<ProviderPollResult> {
    const age = Date.now() - parseInt(providerJobId.split("_")[1]);
    if (age < 5000) {
      console.log(`[DummyProvider] Job ${providerJobId} still running (${age}ms)`);
      return { status: "running" };
    }
    console.log(`[DummyProvider] Job ${providerJobId} succeeded`);
    return {
      status: "succeeded",
      outputUrl: `dummy://output/${providerJobId}.png`,
    };
  }

  async download(outputUrl: string, destPath: string): Promise<void> {
    const fs = await import("fs");
    const path = await import("path");
    const dir = path.dirname(destPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(destPath, `Dummy output from ${outputUrl}`);
    console.log(`[DummyProvider] Downloaded to ${destPath}`);
  }
}

const providers = new Map<string, JobProvider>();

export function registerProvider(provider: JobProvider) {
  providers.set(provider.name, provider);
}

export function getProvider(name: string): JobProvider {
  const provider = providers.get(name);
  if (!provider) throw new Error(`Unknown provider: ${name}`);
  return provider;
}

// Register all providers
registerProvider(new DummyProvider());
