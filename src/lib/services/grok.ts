// The prompt engineering below is provider-agnostic: the same system prompts
// and image parts are sent to whichever model the operator picked. Only the
// transport differs, and that lives in ./llm.
import {
  chatCompletion,
  type ContentPart,
  type PromptProvider,
} from "./llm";
import { readMediaBytes } from "@/lib/local-files";

export type { PromptProvider };

// Return an image as a base64 data URI (the providers' URL fetchers choke on
// CloudFront's content-type headers, so we inline the bytes ourselves).
// readMediaBytes reads straight from disk when the URL is one of our own
// /api/files links, which is both faster and immune to the session check.
async function toDataUri(url: string): Promise<string> {
  const buf = await readMediaBytes(url);

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
  poseOverride?: string; // Force this body posture instead of the reference's
  backgroundRefUrl?: string; // Location image — becomes the scene's environment
  backgroundDescription?: string; // Frozen location text — used verbatim (preferred)
  provider?: PromptProvider; // which model writes it; defaults to Grok
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

export async function describeBackground(
  imageUrl: string,
  provider: PromptProvider = "grok"
): Promise<string> {
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
    { provider, temperature: 0.2, maxTokens: 400 }
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

  // Posture is the one thing normally taken wholesale from the Scene Reference,
  // so overriding it needs the same MANDATORY framing the outfit override uses —
  // and an explicit list of what must still come from the reference, or Grok
  // reinterprets the camera and framing to suit the new pose.
  if (input.poseOverride?.trim()) {
    parts.push({
      type: "text",
      text: `POSE OVERRIDE (MANDATORY): The subject's body posture MUST be EXACTLY: "${input.poseOverride}". Fill the pose fields (type, orientation, arms, legs, spine) to describe THAT posture in concrete detail, and completely ignore the posture in the Scene Reference. Everything else still comes from the Scene Reference: camera type, lens, depth of field, angle, framing, crop, environment, lighting and photographic style.`,
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
    { provider: input.provider ?? "grok", temperature: 0.7, maxTokens: 1500 }
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

// Subtle-motion variant, for casual selfie-style shots where the driving clip
// is a person barely moving. Per Higgsfield's own Seedance guide the single
// most useful instruction is stating what the camera is NOT doing — that is
// what keeps the perspective locked instead of drifting into a new shot. The
// "subtle / gentle / slight" vocabulary is the documented way to damp motion
// down on both Seedance and Kling.
const SEEDANCE_NATURAL_TEMPLATE = `Animate the subject in @[Image 1](image_1) using the motion from @[Video 1](video_1).

Keep the movements exactly the same as @[Video 1](video_1) — subtle and natural: gentle head tilt, slight smile, soft blinking, easy breathing, hair shifting softly. No exaggerated gestures, no dancing, no fast movement.

Single continuous shot: no cuts, no zoom in, no zoom out, no dolly, no orbit. The camera is handheld and shifts only slightly with her hand — minimal and steady, settling as she settles, with no drifting, floating or wandering of its own. It is not on a tripod, and her arms and hands keep moving naturally throughout.

Maintain the facial identity, skin texture, and features of @[Image 1](image_1) as the primary visual reference throughout the entire duration.`;

// ── Seedance image-to-video: action → motion prompt ──
// Image-to-video has no driving clip, so the prompt is the ONLY thing carrying
// motion — which makes it the one place a bad prompt shows up immediately as
// drifting camera or exaggerated movement. The rules below are the documented
// ones: describe only how the still evolves (never re-describe what is already
// visible), damp the motion with "subtle/gentle/slight", and state explicitly
// what the camera is NOT doing, which is what keeps the framing locked.
const SEEDANCE_MOTION_SYSTEM = `You write motion prompts for Seedance 2.0 image-to-video. A single still image is the first frame; your prompt describes how it comes to life.

Rules:
1. Describe ONLY movement and how the scene evolves from the still. NEVER re-describe the person's face, hair, clothing, body or the location — the image already carries all of that, and repeating it makes the model redraw and drift.
2. NO DELIBERATE CAMERA MOVES. Always ban these explicitly: no zoom in, no zoom out, no dolly, no orbit, no crane, no sweeping pans, no cuts, single continuous shot. These are what make a clip look artificial.
2b. THE CAMERA IS HANDHELD BUT BARELY MOVES, AND ONLY BECAUSE SHE DOES. The phone is in her hand, so the frame must be free to shift with her arm — a physically fixed frame forces the arm to freeze, which is the most common failure here. But the movement is MOTIVATED and MINIMAL: the frame moves only as her hand moves, by the smallest amount needed to keep her in shot, and it settles the instant she settles. Phrase it like: "handheld, the frame shifts only slightly with her hand, minimal and steady, settling as she settles." BAN unmotivated motion by name every time: no random drift, no floating, no wandering or roaming, no shake, no jitter, no swinging, no camera motion of its own. Equally, NEVER call the shot locked, static, fixed, mounted or tripod-like.
2c. HER BODY IS NEVER STILL. Her arms, hands, shoulders and head keep moving naturally. If she is holding a phone, state that the phone-holding arm travels with her — shoulder rotating, elbow bending, wrist re-angling to keep herself in frame — and that the arm is never rigid or frozen.
3. Motion must read as real and unperformed — a real person filming themselves, not a model posing. Damp everything with "subtle", "gentle", "slight", "slow", "natural". Never fast, dramatic, bouncy, exaggerated, or dance-like.
4. Always include quiet human life: soft natural blinking, easy relaxed breathing, micro-shifts of weight, hair settling. These are what stop a face looking frozen.
5. Keep the subject's identity, face and proportions perfectly consistent for the whole clip.
6. TURNS END AND HOLD: any turn is ONE partial movement — at most a half turn at the waist or hips — that completes and then HOLDS in the final pose for the rest of the clip. State this explicitly: "one single half turn", "she stops and holds", "she does not keep rotating". NEVER produce a full rotation, a 360, a spin, a pirouette, or any looping/continuous rotation, and say so in the prompt.
7. Write ONE paragraph, 45-75 words, plain declarative sentences. No shot lists, no timestamps, no markdown, no camera jargon beyond the lock statement.

Output ONLY the prompt text.`;

// Turn a short operator-chosen action ("tilting head, slightly smiling") into a
// full Seedance image-to-video prompt.
export async function generateSeedanceMotionPrompt(
  action: string,
  provider: PromptProvider = "grok"
): Promise<string> {
  const content = await chatCompletion(
    [
      { role: "system", content: SEEDANCE_MOTION_SYSTEM },
      {
        role: "user",
        content: `Action the subject performs: ${action.trim()}

Write the Seedance image-to-video motion prompt.`,
      },
    ],
    { provider, temperature: 0.6, maxTokens: 300 }
  );
  return content.trim();
}

// Returns the Seedance prompt. Deterministic — no LLM call, no frame sampling.
// `natural` swaps in the subtle-motion wording for selfie-style shots.
export async function generateSeedancePrompt(
  natural: boolean = false
): Promise<string> {
  return natural ? SEEDANCE_NATURAL_TEMPLATE : SEEDANCE_TEMPLATE;
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
  images: string[],
  provider: PromptProvider = "grok"
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
    { provider, temperature: 1.0, maxTokens: 1200 }
  );

  const json = extractJson(content);
  if (json && typeof json.name === "string" && typeof json.featureProfile === "string") {
    return { name: json.name, featureProfile: json.featureProfile };
  }
  // Fallback: use the raw content as the profile with a placeholder name.
  return { name: "New Persona", featureProfile: content };
}
