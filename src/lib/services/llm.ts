// Provider-agnostic chat transport for every prompt-writing call in the app.
//
// Both providers speak the OpenAI chat-completions shape — x.ai natively, and
// Gemini through Google's OpenAI compatibility endpoint — so the message
// building in grok.ts (system prompt + interleaved text and base64 image parts)
// is byte-identical for both. Only the base URL, key and model differ, which is
// why swapping provider is a one-field change rather than a second client.

export type PromptProvider = "grok" | "gemini";

export const PROMPT_PROVIDERS: PromptProvider[] = ["grok", "gemini"];

export function isPromptProvider(value: unknown): value is PromptProvider {
  return value === "grok" || value === "gemini";
}

// Falls back to Grok for any unrecognised value, so a stale client or a missing
// field can never leave a request without a provider.
export function coercePromptProvider(value: unknown): PromptProvider {
  return isPromptProvider(value) ? value : "grok";
}

export type ContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string | ContentPart[];
}

interface ProviderConfig {
  label: string;
  baseUrl: string;
  apiKey: string | undefined;
  keyName: string;
  model: string;
}

function configFor(provider: PromptProvider): ProviderConfig {
  if (provider === "gemini") {
    return {
      label: "Gemini",
      // Google's OpenAI-compatible surface. Overridable because Google has
      // moved this path before.
      baseUrl:
        process.env.GEMINI_BASE_URL ||
        "https://generativelanguage.googleapis.com/v1beta/openai",
      apiKey: process.env.GEMINI_API_KEY,
      keyName: "GEMINI_API_KEY",
      // Model ids churn fast and Google retires them for new keys without
      // warning (gemini-2.5-flash already 404s for this key), so this is
      // env-overridable. 3.5-flash is the default over 3.7-flash because
      // 3.7 returned 503 "high demand" on most calls while 3.5 answered in
      // 2-3s; both were verified working for vision.
      model: process.env.GEMINI_MODEL || "gemini-3.5-flash",
    };
  }
  return {
    label: "Grok",
    baseUrl: process.env.XAI_BASE_URL || "https://api.x.ai/v1",
    apiKey: process.env.XAI_API_KEY,
    keyName: "XAI_API_KEY",
    model: process.env.XAI_MODEL || "grok-4.3",
  };
}

interface ChatResponse {
  choices: Array<{ message: { content: string } }>;
}

// Gemini returns 503 "experiencing high demand" intermittently — seen three
// times while wiring this up, on requests that succeed seconds later. Losing an
// operator's prompt (and, on a batch, the whole run) to a load blip isn't
// acceptable, so retry the statuses that mean "try again", never the ones that
// mean "this request is wrong".
const RETRYABLE = new Set([429, 500, 502, 503, 504]);
const MAX_TRIES = 4;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function chatCompletion(
  messages: ChatMessage[],
  options?: {
    provider?: PromptProvider;
    temperature?: number;
    maxTokens?: number;
    model?: string;
  }
): Promise<string> {
  const provider = options?.provider ?? "grok";
  const cfg = configFor(provider);
  if (!cfg.apiKey) {
    throw new Error(
      `${cfg.label} is selected but ${cfg.keyName} is not configured`
    );
  }

  // Gemini 3.x spends the output budget on reasoning tokens before it writes a
  // word, so a limit sized for a non-reasoning model truncates the answer
  // instead of capping it: at max_tokens 300 a motion prompt came back as the
  // single word "Realistic" (8 completion tokens out of 339 total). Give Gemini
  // room for the thinking; the callers' limits still bound Grok exactly.
  const requested = options?.maxTokens ?? 1500;
  const maxTokens =
    provider === "gemini" ? Math.max(requested * 4, 2048) : requested;

  const body = JSON.stringify({
    model: options?.model ?? cfg.model,
    messages,
    temperature: options?.temperature ?? 0.8,
    max_tokens: maxTokens,
  });

  let lastError = "";
  for (let attempt = 1; attempt <= MAX_TRIES; attempt++) {
    const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${cfg.apiKey}`,
        "Content-Type": "application/json",
      },
      body,
    });

    if (res.ok) {
      const data: ChatResponse = await res.json();
      return data.choices[0]?.message?.content?.trim() || "";
    }

    lastError = await res.text();
    if (!RETRYABLE.has(res.status) || attempt === MAX_TRIES) {
      // Name the provider in the error — with two of them wired up, "API error
      // (400)" alone doesn't say which one to go and look at.
      throw new Error(
        `${cfg.label} API error (${res.status}): ${lastError}`
      );
    }
    console.log(
      `[LLM] ${cfg.label} ${res.status} — retrying (${attempt}/${MAX_TRIES - 1})`
    );
    await sleep(1500 * attempt);
  }

  throw new Error(`${cfg.label} API error: ${lastError}`);
}
