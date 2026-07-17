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

// Placeholder replaced (both in the prompt and post-parse) with the selected
// Higgsfield character's name, so the LoRA reference matches the chosen persona.
const CHARACTER_NAME_TOKEN = "{{CHARACTER_NAME}}";

// The operator's structured "reverse-engineer to JSON" recreation prompt. Grok
// analyzes the reference image and emits the strict JSON schema below. The
// character LoRA name is injected from the selected Higgsfield character.
const SUBJECT_SWAP_SYSTEM = `Role: You are an expert AI Prompt Engineer specializing in reverse-engineering reference photos into hyper-accurate text prompts for image generation models. Your goal is to analyze any image provided by the user and recreate its composition flawlessly.

Task Instructions:
1. Analyze the user's reference image for subject details, clothing, body posture, background scenery, camera perspective, and lighting quality.
2. Output a single, perfectly formatted JSON block following the strict structure template provided below.
3. STRICT CONSTRAINT 1 (No Tattoos — ABSOLUTE): This is the single most important rule. The subject's skin is ALWAYS clean, bare, smooth, and completely unmarked. Even if the reference image clearly shows tattoos, ink, body art, markings, lettering, or symbols on the skin, you MUST completely ignore them and describe the skin as smooth and unmarked. NEVER mention, describe, hint at, or imply tattoos or any skin markings in ANY field. CRITICAL: Do NOT write the words "tattoo", "ink", "body art", or any skin-marking term ANYWHERE in your output — not in the descriptions AND not in the negative_prompt array (the image model reads the whole output as positive text, so even listing the word causes it). Instead, reinforce cleanliness POSITIVELY: put "smooth clean unmarked skin" in both the subject description and anatomy fields.
4. STRICT CONSTRAINT 2 (No Hair Color): You may describe hair length, volume, style (e.g., straight, wavy, braids, pigtails, bangs), but you must NEVER mention any hair color (e.g., blonde, brunette, black, brown). You must explicitly include "hair color description" in the negative_prompt array.
4b. STRICT CONSTRAINT 2b (No Glasses / Eyewear): The subject NEVER wears glasses, eyeglasses, sunglasses or any eyewear. Even if the reference image shows them, ignore them completely — describe the eyes and face as bare, with no eyewear. Do NOT write the words "glasses", "eyeglasses", "sunglasses", "eyewear", "spectacles" or "shades" ANYWHERE in your output (not in descriptions and not in negative_prompt — the model reads the whole output as positive text). Simply describe the face without any eyewear.
5. STRICT CONSTRAINT 3 (Character LORA): Always include the "loras" block exactly as shown in the template. Set "character_lora" to "<lora:${CHARACTER_NAME_TOKEN}:1.0>" using the CHARACTER NAME provided in the user message verbatim — do not invent, translate, or alter it.
6. BACKGROUND REFERENCE (only when one is provided): You may be given a separate BACKGROUND REFERENCE image — a location/room, usually with no people in it. When it is provided:
   - The "environment.location" field MUST describe THAT location in rich detail (room type, surfaces, furniture, props, depth, what is visible behind and beside the subject). NEVER describe the Scene Reference's background.
   - The "lighting" fields MUST match that location's light — its direction, colour, softness and sources — so the subject is lit believably for that space.
   - Write it as though the subject was genuinely photographed standing in that place: the result must read as one real photo taken there, not a cut-out pasted onto a backdrop.
   - Take ONLY the environment and its light from the Background Reference. Everything else — pose, body position, expression, eye direction, camera angle, framing, crop and photographic style/flaws — still comes from the Scene Reference.

Output Format Template:
{
  "subject": {
    "name": "",
    "description": "",
    "attire": "",
    "anatomy": "",
    "accessories": ""
  },
  "pose": {
    "type": "",
    "orientation": "",
    "expression": "",
    "arms": "",
    "legs": "",
    "spine": ""
  },
  "environment": {
    "location": ""
  },
  "camera": {
    "type": "",
    "lens": "",
    "dof": ""
  },
  "lighting": {
    "sources": [],
    "quality": ""
  },
  "output": {
    "ratio": "3:4",
    "orientation": "Portrait",
    "style": "Authentic, casual snapshot appearance, realistic unedited skin texture, sharp clothing fabric detail, no professional studio filters."
  },
  "loras": {
    "character_lora": "<lora:${CHARACTER_NAME_TOKEN}:1.0>"
  },
  "controls": {
    "pose": "DWPose (1.0)",
    "depth": "ZoeDepth (0.8)"
  },
  "negative_prompt": [
    "body averaging",
    "hair color description",
    "studio lighting",
    "artificial bokeh",
    "heavy skin smoothing",
    "airbrushed appearance",
    "3d render",
    "illustration",
    "drawing"
  ]
}

Output ONLY the JSON object, no other text.`;

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
  characterName?: string; // Selected Higgsfield character — used as the LoRA name
  outfitOverride?: string; // Force this outfit instead of the reference's clothing
  backgroundRefUrl?: string; // Location image — becomes the scene's environment
  backgroundDescription?: string; // Frozen location text — used verbatim (preferred)
}

// Describe a location image ONCE so the text can be frozen and reused. Running
// this per-generation is what caused backgrounds to drift between stills.
const BACKGROUND_DESCRIBE_SYSTEM = `You describe a location/room photograph so it can be reproduced consistently by an image generator.

Rules:
- Describe ONLY the place: room type, walls, floor, surfaces, furniture, props, what is visible in the background and at the edges, sense of depth, and the lighting (its sources, direction, colour temperature and softness).
- Do NOT describe any person, body, clothing, or pose — even if someone appears in the photo, ignore them completely.
- Be concrete and specific (materials, colours, objects, layout) so the same room can be re-rendered from the text alone.
- One dense paragraph, 40-90 words. No preamble, no bullet points, no commentary.

Output ONLY the description text.`;

export async function describeBackground(imageUrl: string): Promise<string> {
  const content = await chatCompletion(
    [
      { role: "system", content: BACKGROUND_DESCRIBE_SYSTEM },
      {
        role: "user",
        content: [
          { type: "text", text: "Describe this location:" },
          { type: "image_url", image_url: { url: await toDataUri(imageUrl) } },
        ],
      },
    ],
    { model: VISION_MODEL, temperature: 0.2, maxTokens: 400 }
  );
  return content.trim();
}

// Banned terms purged from every output field. On Higgsfield (no negative-prompt
// support) even the WORD "tattoo"/"glasses" in the output backfires, so we strip
// them everywhere. Tattoos/skin-markings + eyewear.
const BANNED_TERMS_RE =
  /\b(tattoos?|ink(?:ed)?|body ?art|body markings?|skin markings?|markings?|glasses|eyeglasses|eyewear|spectacles|sunglasses|shades)\b/gi;

function scrubBanned(v: unknown): unknown {
  if (typeof v === "string") {
    return v
      .replace(BANNED_TERMS_RE, "")
      .replace(/\s{2,}/g, " ")
      .replace(/\s+([.,])/g, "$1")
      .trim();
  }
  if (Array.isArray(v)) {
    return v.map(scrubBanned).filter((x) => x !== "" && x != null);
  }
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    for (const k of Object.keys(o)) o[k] = scrubBanned(o[k]);
    return o;
  }
  return v;
}

// Force the required constraints into the parsed JSON regardless of what Grok
// returned: correct character LoRA name, no tattoo terms anywhere, and the
// mandatory hair-color negative.
function enforceRecreationConstraints(
  obj: Record<string, unknown>,
  characterName: string,
  backgroundDescription?: string
): Record<string, unknown> {
  // Purge every banned reference (tattoos/skin-markings, eyewear) from all fields.
  scrubBanned(obj);

  // Force the frozen background text in verbatim. Grok paraphrases even when
  // told not to, and any drift here changes the rendered room — so we overwrite
  // rather than trust the model.
  if (backgroundDescription?.trim()) {
    const env = (obj.environment as Record<string, unknown>) || {};
    env.location = backgroundDescription.trim();
    obj.environment = env;
  }

  const loraName = characterName?.trim() || "character";
  obj.loras = { character_lora: `<lora:${loraName}:1.0>` };

  const neg = Array.isArray(obj.negative_prompt)
    ? (obj.negative_prompt as string[])
    : [];
  if (!neg.includes("hair color description")) neg.push("hair color description");
  obj.negative_prompt = neg;
  return obj;
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

  // A frozen background description wins over the image: it guarantees the same
  // backdrop text (and therefore the same room) on every generation.
  if (input.backgroundDescription?.trim()) {
    parts.push({
      type: "text",
      text: `BACKGROUND DESCRIPTION (MANDATORY environment — REPLACES the Scene Reference's background): set environment.location to EXACTLY this text, verbatim, unchanged:\n\n"${input.backgroundDescription.trim()}"\n\nMatch the lighting fields to the light described there so the subject reads as genuinely photographed in that place. Keep pose, camera, framing and photographic style from the Scene Reference.`,
    });
  } else if (input.backgroundRefUrl) {
    parts.push({
      type: "text",
      text: "BACKGROUND REFERENCE (MANDATORY environment): this location REPLACES the Scene Reference's background. Describe THIS place in environment.location, and match lighting to it. The subject must read as genuinely photographed here. Keep pose, camera, framing and photographic style from the Scene Reference:",
    });
    parts.push({
      type: "image_url",
      image_url: { url: await toDataUri(input.backgroundRefUrl) },
    });
  }

  if (input.settingDescription?.trim()) {
    parts.push({
      type: "text",
      text: `CHARACTER IDENTITY NOTES (subject description — obey the no-hair-color and no-tattoo constraints): ${input.settingDescription}`,
    });
  }

  if (input.outfitOverride?.trim()) {
    parts.push({
      type: "text",
      text: `OUTFIT OVERRIDE (MANDATORY): Dress the subject in EXACTLY this outfit — the subject.attire field MUST describe: "${input.outfitOverride}". Completely ignore and replace any clothing seen in the Scene Reference; keep the pose, body, setting, and lighting from the Scene Reference.`,
    });
  }

  const characterName = input.characterName?.trim() || "character";
  parts.push({
    type: "text",
    text: `CHARACTER NAME (use this EXACT value verbatim for loras.character_lora): ${characterName}`,
  });

  parts.push({
    type: "text",
    text: "Now analyze the reference image and produce the recreation JSON per the template. Output ONLY the JSON object.",
  });

  const content = await chatCompletion(
    [
      { role: "system", content: SUBJECT_SWAP_SYSTEM },
      { role: "user", content: parts },
    ],
    { model: VISION_MODEL, temperature: 0.7, maxTokens: 1500 }
  );

  const json = extractJson(content);
  if (json) {
    // Guarantee the LoRA name, mandatory negatives, and the frozen background
    // text no matter what Grok emitted.
    const enforced = enforceRecreationConstraints(
      json,
      characterName,
      input.backgroundDescription
    );
    return JSON.stringify(enforced, null, 2);
  }

  // Fallback: return raw content if it isn't valid JSON
  return content;
}

// ── Seedance video prompt (static, operator-authored) ──
// No Grok call: Higgsfield reads the linked @[Image 1]/@[Video 1] elements
// directly, so it doesn't need a written-out movement sequence. Grok-authored
// technical prompts also got taken literally (e.g. "pixel projection" /
// "geometry" produced a 3D wireframe render), so we keep this plain and simple.
const SEEDANCE_TEMPLATE = `Animate the subject in @[Image 1](image_1) using the motion from @[Video 1](video_1).

Keep the movements exactly the same as @[Video 1](video_1).

Maintain the facial identity, skin texture, and features of as the primary visual reference throughout the entire duration.`;

// Returns the Seedance prompt. Deterministic — no LLM call, no frame sampling.
export async function generateSeedancePrompt(): Promise<string> {
  return SEEDANCE_TEMPLATE;
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
