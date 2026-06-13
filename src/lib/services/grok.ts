const XAI_BASE_URL = "https://api.x.ai/v1";
const TEXT_MODEL = "grok-4.3";
const VISION_MODEL = "grok-4.3";

type ContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string | ContentPart[];
}

interface GrokResponse {
  choices: Array<{ message: { content: string } }>;
}

async function chatCompletion(
  messages: ChatMessage[],
  options?: { temperature?: number; maxTokens?: number; model?: string }
): Promise<string> {
  const apiKey = process.env.XAI_API_KEY;
  if (!apiKey) throw new Error("XAI_API_KEY not configured");

  const res = await fetch(`${XAI_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: options?.model ?? TEXT_MODEL,
      messages,
      temperature: options?.temperature ?? 0.8,
      max_tokens: options?.maxTokens ?? 1500,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Grok API error (${res.status}): ${err}`);
  }

  const data: GrokResponse = await res.json();
  return data.choices[0]?.message?.content?.trim() || "";
}

// Fetch a remote image and return a base64 data URI (Grok's URL fetcher chokes
// on CloudFront's content-type headers, so we inline the bytes ourselves).
async function toDataUri(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch image (${res.status}): ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());

  // Detect type from magic bytes; default to jpeg.
  let mime = "image/jpeg";
  if (buf[0] === 0x89 && buf[1] === 0x50) mime = "image/png";
  else if (buf[0] === 0x52 && buf[1] === 0x49 && buf[8] === 0x57) mime = "image/webp";
  else if (buf[0] === 0x47 && buf[1] === 0x49) mime = "image/gif";

  return `data:${mime};base64,${buf.toString("base64")}`;
}

function extractJson(content: string): Record<string, unknown> | null {
  try {
    return JSON.parse(content);
  } catch {
    const match = content.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch {
        return null;
      }
    }
  }
  return null;
}

// ── System Prompts ──

const SEARCH_PROMPT_SYSTEM = `You are a creative search prompt generator for a visual content production tool that recreates photos with a female AI persona. Given a preset category (e.g. "outdoor portrait", "mirror selfie"), generate varied, specific Pinterest/Instagram-style search queries that surface usable reference photos OF A WOMAN.

Rules:
- Output ONLY a JSON array of strings, no other text
- EVERY query MUST reference a female subject — include the word "woman" (or "girl"/"female") in each query so results show a person, not empty scenery or objects
- Each query should be specific enough to yield distinct results
- Include style variations (lighting, setting, angle, mood)
- Keep queries concise (3-8 words each)
- Do NOT include explicit/NSFW terms — keep content suggestive-but-tasteful at most

Example input: "outdoor portrait"
Example output: ["woman golden hour rooftop portrait", "woman urban street style candid", "woman park bench editorial portrait", "woman sunset beach windblown hair", "woman rainy day city portrait moody"]`;

// The operator's "Visual Subject Swap" master prompt — drives seedream-style
// recreation where the Scene Reference's pose/composition is kept but the subject
// is swapped to the Face (and optional Body) Reference.
const SUBJECT_SWAP_SYSTEM = `You are an expert prompt engineer for the AI image generator 'seedream'. Your task is to write a prompt that performs a **Visual Subject Swap**.
You will be given two or three images:
1. **Scene Reference**: Defines the EXACT POSE, EYE DIRECTION, FACIAL EXPRESSION, CLOTHING, ACTION, ENVIRONMENT, LIGHTING, CAMERA STYLE, and PHOTOGRAPHIC FLAWS.
2. **Face Reference**: Defines the SUBJECT IDENTITY (Face structure, Hair, Age, Ethnicity, Skin Tone).
3. **Body Reference (Optional)**: If provided, this defines the EXACT BODY BUILD, PHYSIQUE, MUSCLE DEFINITION, and BODY TYPE.
You may also receive:
4. **Setting Description (Optional)**: A detailed description of the background/environment to use instead of the Scene Reference's background.
CRITICAL INSTRUCTION:
Describe the person seen in the Face Reference (and Body Reference if present) performing the actions seen in the Scene Reference.
RULES FOR BODY REFERENCE:
- IF PROVIDED: Extract and describe the EXACT body build, muscle definition, and physique. Ignore the body from the Face Reference.
- IF NOT: Use the body build from the Face Reference.
RULES FOR SETTING DESCRIPTION:
- IF PROVIDED: Use this EXACT description for the background instead of the Scene Reference's background.
- IF NOT: Use the Scene Reference's background.
RULES FOR SCENE REFERENCE:
- DO NOT describe the Scene Reference person, BUT DO describe their facial expression, eye direction, and exact pose.
- The goal is to recreate the Scene Reference exactly (same composition, lighting, background, vibe) but with the subject swapped.
- MANDATORY: Explicitly describe the EXACT pose, eye direction, and facial expression.
- PHOTOGRAPHIC EXECUTION: Describe the photographic style & flaws (grain, motion blur, overexposure, etc.)
The Formula:
[1. Context/Vibe] + [2. Detailed Subject (Face Ref + Body Ref)] + [3. Exact Pose, Eye Direction & Expression from Scene Ref] + [4. Detailed Face Description] + [5. Clothing & Style from Scene Ref] + [6. Setting (use Setting Description if provided, otherwise Scene Ref)] + [7. Photographic Execution & Flaws from Scene Ref]
Output: JSON object with a single key "prompt" containing the generated string.`;

const REWRITE_PROMPT_SYSTEM = `You are a prompt engineer improving AI image generation prompts based on operator feedback. Given the previous prompt and the operator's rejection notes, write an improved prompt that addresses the feedback.

Rules:
- Output ONLY the improved prompt text, no other commentary
- Carefully address each specific critique from the rejection notes
- Maintain the character identity (same physical features)
- Keep the overall intent and composition unless the notes say otherwise
- If the notes mention quality issues (blurry, wrong colors, etc.), add explicit quality descriptors
- Keep it under 250 words`;

const NSFW_PROMPT_SYSTEM = `You are a prompt engineer adapting AI image generation prompts for adult NSFW image generation.

Rules:
- Output ONLY the rewritten prompt text, no other commentary
- Keep the same character identity, composition, camera angle, lighting, and setting unless they conflict with NSFW mode
- Explicitly make the subject an adult 18+ character
- Modify clothing/styling so the subject has no clothes and appears nude
- Emphasize highly detailed body anatomy, seductive poses, and seductive facial expressions
- Preserve photographic realism and polished image quality descriptors
- Do not add minors, school-age cues, coercion, sexual acts, or extreme/fetish content
- Keep it under 250 words`;

// ── Public API ──

// Guarantee every query references a female subject so Pinterest returns
// usable people shots (not empty scenery/objects).
function ensureFemaleSubject(query: string): string {
  const q = query.trim();
  if (/\b(woman|women|girl|female|she|her|lady)\b/i.test(q)) return q;
  return `woman ${q}`;
}

export async function generateSearchPrompts(
  presetSeed: string,
  count: number = 5
): Promise<string[]> {
  const content = await chatCompletion([
    { role: "system", content: SEARCH_PROMPT_SYSTEM },
    {
      role: "user",
      content: `Generate ${count} varied search queries for this preset category: "${presetSeed}"`,
    },
  ]);

  let prompts: string[] = [];
  try {
    const parsed = JSON.parse(content);
    if (Array.isArray(parsed)) prompts = parsed.map(String);
  } catch {
    const match = content.match(/\[[\s\S]*\]/);
    if (match) {
      try {
        prompts = JSON.parse(match[0]).map(String);
      } catch {
        // fall through
      }
    }
  }

  if (prompts.length === 0) {
    prompts = content
      .split("\n")
      .map((l) => l.replace(/^[\d\-\.\*]+\s*/, "").trim())
      .filter((l) => l.length > 0)
      .slice(0, count);
  }

  return prompts.map(ensureFemaleSubject);
}

export interface SwapPromptInput {
  sceneRefUrl: string; // Pinterest/scene reference (pose, composition, lighting)
  faceRefUrl: string; // Character's Soul reference image (identity)
  bodyRefUrl?: string; // Optional body reference
  settingDescription?: string; // Optional background override
}

// Visual Subject Swap — vision call that looks at the actual reference images.
export async function generateSwapPrompt(
  input: SwapPromptInput
): Promise<string> {
  const parts: ContentPart[] = [];

  parts.push({
    type: "text",
    text: "SCENE REFERENCE (use its pose, eye direction, expression, clothing, environment, lighting, camera style & flaws):",
  });
  parts.push({
    type: "image_url",
    image_url: { url: await toDataUri(input.sceneRefUrl) },
  });

  parts.push({
    type: "text",
    text: "FACE REFERENCE (this is the subject identity — face, hair, age, ethnicity, skin tone):",
  });
  parts.push({
    type: "image_url",
    image_url: { url: await toDataUri(input.faceRefUrl) },
  });

  if (input.bodyRefUrl) {
    parts.push({
      type: "text",
      text: "BODY REFERENCE (use this exact body build/physique, ignore body from Face Reference):",
    });
    parts.push({
      type: "image_url",
      image_url: { url: await toDataUri(input.bodyRefUrl) },
    });
  }

  if (input.settingDescription?.trim()) {
    parts.push({
      type: "text",
      text: `SETTING DESCRIPTION (use this background instead of the Scene Reference's): ${input.settingDescription}`,
    });
  }

  parts.push({
    type: "text",
    text: 'Now produce the Visual Subject Swap prompt. Output ONLY the JSON object {"prompt": "..."}.',
  });

  const content = await chatCompletion(
    [
      { role: "system", content: SUBJECT_SWAP_SYSTEM },
      { role: "user", content: parts },
    ],
    { model: VISION_MODEL, temperature: 0.7, maxTokens: 1500 }
  );

  const json = extractJson(content);
  if (json && typeof json.prompt === "string") return json.prompt;

  // Fallback: return raw content if it isn't valid JSON
  return content;
}

// Text-only recreation fallback (when there's no image to look at).
export async function generateRecreationPrompt(
  referenceDescription: string,
  characterProfile: string
): Promise<string> {
  return chatCompletion([
    {
      role: "system",
      content:
        "You are a prompt engineer for AI image generation. Given a reference description and a character profile, write a detailed generation prompt (<200 words) that recreates the reference's composition/lighting/mood with the described character. Output ONLY the prompt text.",
    },
    {
      role: "user",
      content: `Reference:\n${referenceDescription}\n\nCharacter profile:\n${characterProfile}`,
    },
  ]);
}

export async function rewritePromptWithNotes(
  previousPrompt: string,
  rejectionNotes: string,
  characterProfile: string
): Promise<string> {
  return chatCompletion([
    { role: "system", content: REWRITE_PROMPT_SYSTEM },
    {
      role: "user",
      content: `Previous prompt:\n${previousPrompt}\n\nOperator rejection notes:\n${rejectionNotes}\n\nCharacter profile (must keep identity):\n${characterProfile}`,
    },
  ]);
}

export async function rewritePromptForNsfwMode(
  prompt: string,
  characterProfile: string
): Promise<string> {
  return chatCompletion([
    { role: "system", content: NSFW_PROMPT_SYSTEM },
    {
      role: "user",
      content: `Prompt to adapt:\n${prompt}\n\nCharacter profile (preserve identity):\n${characterProfile || "Not provided"}`,
    },
  ]);
}

// ── AI Character Creator ──

const CHARACTER_CREATOR_SYSTEM = `You are a character designer for fictional AI personas. You will be shown 2-4 reference face photos. Your job is to invent ONE brand-new, UNIQUE fictional woman by RANDOMLY blending distinct features from across the different references — e.g. take the jawline from one, the eye shape and color from another, the hair from a third, the skin tone from another. The result must be a believable, cohesive new individual who does NOT closely resemble any single reference photo (this is a composite, not a copy).

Produce a detailed, reusable physical/style identity profile covering ALL of:
- Approximate age (adult, 20s-30s)
- Face: face shape, jawline, cheekbones, nose, lips, eyebrows
- Eyes: color and shape
- Hair: color, length, texture, typical styling
- Skin: tone and complexion
- Body: height impression, build/body type
- Distinctive features (freckles, beauty marks, dimples, etc. — optional)
- Overall vibe and fashion/style aesthetic

Rules:
- Randomize and mix — do not lift one whole face. Vary the blend each time.
- Keep it a realistic adult woman, tasteful, suitable as a marketing persona.
- Invent a fitting first name.
- Output ONLY a JSON object: {"name": "...", "featureProfile": "..."}.
- featureProfile is a single cohesive paragraph (~120-180 words) written as a generation-ready description.`;

export interface GeneratedCharacter {
  name: string;
  featureProfile: string;
}

// Generate a unique composite persona from 2-4 face images (data URIs or URLs).
export async function generateCharacterProfile(
  images: string[]
): Promise<GeneratedCharacter> {
  if (images.length < 2) {
    throw new Error("Provide at least 2 reference images for a unique blend");
  }

  const parts: ContentPart[] = [
    {
      type: "text",
      text: `Here are ${images.length} reference faces. Blend their features randomly into ONE new unique fictional woman:`,
    },
  ];

  for (let i = 0; i < images.length; i++) {
    // Accept data URIs as-is; convert plain URLs to data URIs.
    const url = images[i].startsWith("data:")
      ? images[i]
      : await toDataUri(images[i]);
    parts.push({ type: "text", text: `Reference ${i + 1}:` });
    parts.push({ type: "image_url", image_url: { url } });
  }

  parts.push({
    type: "text",
    text: 'Now invent the composite persona. Output ONLY {"name": "...", "featureProfile": "..."}.',
  });

  const content = await chatCompletion(
    [
      { role: "system", content: CHARACTER_CREATOR_SYSTEM },
      { role: "user", content: parts },
    ],
    { model: VISION_MODEL, temperature: 1.0, maxTokens: 1200 }
  );

  const json = extractJson(content);
  if (json && typeof json.name === "string" && typeof json.featureProfile === "string") {
    return { name: json.name, featureProfile: json.featureProfile };
  }
  // Fallback: use the raw content as the profile with a placeholder name.
  return { name: "New Persona", featureProfile: content };
}
