// Patch a saved recreation prompt with a new outfit / hair / makeup /
// background — the whole point of a baked-in prompt is that a proven pose and
// composition can be re-dressed without paying for another Grok vision call.
//
// Pure JSON manipulation, no server deps, so the Seedance page imports it
// directly. Mirrors what enforceRecreationConstraints does server-side: the
// values are written in rather than requested, because a model asked politely
// to change one field tends to rewrite several.

export interface PromptOverrides {
  // Identity — a preset is character-agnostic: the pose/scene it captures is
  // reusable by any character, so these MUST be re-pointed on every use or a
  // prompt saved under one character keeps rendering that character.
  characterName?: string; // drives loras.character_lora
  characterProfile?: string; // the character's feature profile → subject.description

  outfit?: string;
  hair?: string;
  makeup?: string;
  // Bust size. The operator types just a size ("34C", "DD", "small"), so a
  // bare bra size is expanded into wording an image model can act on.
  chest?: string;
  // Butt size. Free text ("full", "round", "small") — there is no standard
  // sizing here, so the words are kept as typed and only the noun is added.
  butt?: string;
  // No body size was given, so the character LoRA owns the body: the
  // reference's own build must not ride along, or every still inherits the
  // physique of whoever was in the source clip. Passed explicitly rather than
  // inferred from blank sizes, so a caller that doesn't offer body fields at
  // all isn't silently changed.
  bodyFromLora?: boolean;
  pose?: string; // body posture — replaces the one the prompt was written from
  background?: string; // frozen location text
}

// Reinforced positively rather than via negatives — naming a banned thing at
// all makes the image model render it (see the Grok system prompt).
const CLEAN_SKIN = "smooth clean unmarked skin";

// Hair COLOUR must never appear in a prompt — the character LoRA owns it, and
// naming a colour here fights the identity (same reasoning as the existing
// no-hair-color rule in the Grok system prompt). Style words are kept.
const HAIR_COLOR_WORDS =
  /\b(blonde?|blond|brunette|brown[- ]haired|black[- ]haired|redhead|red[- ]haired|ginger|auburn|platinum|ash[- ]blonde|silver[- ]haired|grey[- ]haired|gray[- ]haired|dyed|highlights?|balayage|ombre)\b/gi;

// Removing a colour word can strand the connective that introduced it
// ("wavy hair with a brunette balayage" → "wavy hair with a"), so tidy up the
// leftovers rather than shipping a half sentence to the model.
// Repeats, because one removal can strand a chain ("… with a" → "… with").
const DANGLING_TAIL = /[\s,]+(?:(?:with|in|and|a|an|the|of|plus)[\s,]*)+$/i;

export function stripHairColor(text: string): string {
  return text
    .replace(HAIR_COLOR_WORDS, "")
    .replace(/\s{2,}/g, " ")
    // collapse ", ," and " ," left behind by a removed word
    .replace(/\s*,\s*(?=,)/g, "")
    .replace(/\s+,/g, ",")
    .replace(DANGLING_TAIL, "")
    // and any punctuation left hanging off either end
    .replace(/[\s,;]+$/, "")
    .replace(/^[\s,;]+/, "")
    .trim();
}

// Grok writes hair (and occasionally makeup) into `subject.description`,
// because its template has no dedicated field for either. Adding a `hair` key
// without clearing that leaves the prompt saying two different things — e.g.
// description "long straight hair" vs hair "sleek high ponytail" — and the
// image model reads the whole JSON as text, so the description wins and the
// chosen style is silently ignored. When an explicit style is supplied we drop
// the competing clauses so only the dedicated field speaks.
const HAIR_NOUNS =
  /\b(hair|hairstyle|ponytail|pony ?tail|bun|braids?|braided|bangs|fringe|updo|pigtails|chignon|curls?|curly|waves?|wavy|locks|tresses|bob|bobbed|afro|dreadlocks|cornrows)\b/i;
const MAKEUP_NOUNS =
  /\b(makeup|make-up|lipstick|lip gloss|eyeliner|eyeshadow|mascara|blush|contour(ing)?|foundation|bronzer|glam)\b/i;
// Bust wording Grok tends to put in `description`/`anatomy`. Left in place it
// contradicts an explicit size, and the wordier clause wins.
const CHEST_NOUNS =
  /\b(bust|busty|breasts?|chest|cleavage|bosom|d[ée]colletage|[a-k]{1,3}[- ]cup|cup size)\b/i;

// Removing bust wording CANNOT go clause-by-clause the way hair does: Grok
// writes the bust into the same breath as the rest of the body ("slim athletic
// build with a modest bust and narrow waist"), so dropping the clause would
// take the build and the waist with it and silently resize the whole body.
// Excise just the bust phrase — its leading connective, article and up to two
// adjectives — and leave every other body descriptor untouched.
const CHEST_PHRASE = new RegExp(
  String.raw`(?:,\s*)?\b(?:with\s+|and\s+)?(?:an?\s+)?` +
    String.raw`(?:(?:[a-z]+(?:-[a-z]+)?|[a-k]{1,3}-cup)\s+){0,2}` +
    String.raw`(?:bust(?:line)?|breasts?|chest|cleavage|bosom|d[ée]colletage)\b`,
  "gi"
);

// Butt wording, same problem and same treatment as the bust. Deliberately does
// NOT include "hips" — hips are a separate body measurement, and stripping them
// would resize the figure, which is exactly what this surgical approach exists
// to avoid. "bottom" is left out too: it collides with "bikini bottom".
const BUTT_NOUNS =
  /\b(butt|buttocks|backside|behind|derri[eè]re|glutes|booty|posterior|rear end)\b/i;

const BUTT_PHRASE = new RegExp(
  String.raw`(?:,\s*)?\b(?:with\s+|and\s+)?(?:an?\s+)?` +
    String.raw`(?:[a-z]+(?:-[a-z]+)?\s+){0,2}` +
    String.raw`(?:butt(?:ocks)?|backside|behind|derri[eè]re|glutes|booty|posterior|rear end)\b`,
  "gi"
);

// Shared tidy-up: a removed phrase can strand the connective that introduced it
// ("slim build with a" → "slim build") or leave doubled punctuation behind.
function tidy(text: string): string {
  return text
    .replace(/\s{2,}/g, " ")
    .replace(/\s+,/g, ",")
    .replace(/,\s*(?=,)/g, "")
    .replace(/[\s,]+(?:with|and|a|an|of)\s*$/i, "")
    .replace(/^[\s,]+|[\s,]+$/g, "")
    .trim();
}

export function stripChestPhrases(text: string): string {
  return tidy(text.replace(CHEST_PHRASE, ""));
}

export function stripButtPhrases(text: string): string {
  return tidy(text.replace(BUTT_PHRASE, ""));
}

// Every way the reference frame's physique gets described. Used only when no
// size was given: the whole point is that the frame supplies pose and
// composition, never the body.
const BODY_SHAPE_NOUNS =
  /\b(build|figure|frame|physique|body ?type|body ?shape|proportions?|curves|thighs?|hips?|waist(?:line)?|midriff|stomach|belly|torso|legs?|shoulders?|bust(?:line)?|breasts?|chest|cleavage|bosom|butt(?:ocks)?|backside|booty|glutes|derri[eè]re|posterior)\b/i;

const BODY_SHAPE_PHRASE = new RegExp(
  String.raw`(?:,\s*)?\b(?:with\s+|and\s+)?(?:an?\s+)?` +
    String.raw`(?:[a-z]+(?:-[a-z]+)?\s+){0,2}` +
    String.raw`(?:build|figure|frame|physique|body ?type|body ?shape|proportions?|curves|thighs?|hips?|waist(?:line)?|midriff|stomach|belly|torso|legs?|shoulders?|bust(?:line)?|breasts?|chest|cleavage|bosom|butt(?:ocks)?|backside|booty|glutes|derri[eè]re|posterior)\b`,
  "gi"
);

export function stripBodyShape(text: string): string {
  return tidy(text.replace(BODY_SHAPE_PHRASE, ""));
}

// No standard sizing for this, so the operator's words are kept exactly as
// typed; we only supply the body-part noun when they left it out ("full" →
// "full butt", but "round backside" is already complete).
export function describeButtSize(input: string): string {
  const text = input.trim();
  if (!text) return "";
  return BUTT_NOUNS.test(text) ? text : `${text} butt`;
}

// "34C" / "DD" / "d cup" → wording the model can act on; anything else
// ("petite", "full figure") is already descriptive and passes through as-is.
// The size the operator typed is always reproduced exactly — band included
// when they gave one — rather than being reduced to the cup letter.
// The band is optional: `(?:\d{2,3})?`, NOT `\d{2,3}?`, which is a lazy
// *required* match and would reject a bare "DD".
const BRA_SIZE = /^\s*(\d{2,3})?\s*([A-K]{1,3})\s*(?:cup)?\s*$/i;

export function describeChestSize(input: string): string {
  const text = input.trim();
  if (!text) return "";
  const match = text.match(BRA_SIZE);
  if (!match) return text;
  const [, band, cup] = match;
  const size = cup.toUpperCase();
  return band ? `natural ${band}${size} bust` : `natural ${size}-cup bust`;
}

// Descriptions are comma-separated clauses ("young woman, blue eyes, long
// straight hair") — drop whole clauses rather than individual words, so we
// never leave a mangled fragment behind.
function dropClauses(text: string, pattern: RegExp): string {
  const kept = text
    .split(",")
    .map((c) => c.trim())
    .filter((c) => c.length > 0 && !pattern.test(c));
  return kept.join(", ");
}

// Characters imported from Higgsfield carry a placeholder profile that is pure
// bookkeeping — "Higgsfield Soul character — imported from Higgsfield.
// Character ref: <uuid>". It says nothing about how the person looks, and a
// UUID in an image prompt is noise the model will try to read. Treat it as no
// profile at all: for a Soul, identity comes from the soul_id anyway.
const IMPORT_PLACEHOLDER =
  /^\s*higgsfield soul character\b|\bcharacter ref:\s*[0-9a-f-]{8,}/i;

export function usefulCharacterProfile(profile?: string | null): string {
  const text = (profile ?? "").trim();
  return !text || IMPORT_PLACEHOLDER.test(text) ? "" : text;
}

type Json = Record<string, unknown>;

// Returns the patched prompt as pretty JSON. If `prompt` isn't valid JSON it is
// returned untouched — a hand-written plain-text prompt still works, we just
// can't surgically patch it.
export function applyOverrides(
  prompt: string,
  overrides: PromptOverrides
): string {
  let parsed: Json;
  try {
    const candidate = JSON.parse(prompt);
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
      return prompt;
    }
    parsed = candidate as Json;
  } catch {
    return prompt;
  }

  const subject = (parsed.subject as Json) ?? {};

  // ── Identity swap ──
  // Everything that makes the prompt *work* (pose, camera, lighting,
  // environment, style) is left exactly as saved; only who is in the shot
  // changes.
  if (overrides.characterName?.trim()) {
    const name = overrides.characterName.trim();
    parsed.loras = { character_lora: `<lora:${name}:1.0>` };
    subject.name = name;
  }
  const realProfile = usefulCharacterProfile(overrides.characterProfile);
  if (realProfile) {
    const profile = stripHairColor(realProfile);
    subject.description = profile.toLowerCase().includes(CLEAN_SKIN)
      ? profile
      : `${profile}, ${CLEAN_SKIN}`;
  }

  if (overrides.outfit?.trim()) {
    subject.attire = overrides.outfit.trim();
  }
  if (overrides.hair?.trim()) {
    // `hair` is not in the original template — adding it is safe (the model
    // reads the whole JSON as text) and keeps it out of the free-form
    // description where it would be hard to replace next time.
    subject.hair = stripHairColor(overrides.hair);
    // …but only after evicting whatever hair the description already claimed,
    // or the two fields contradict each other and the description wins.
    for (const field of ["description", "anatomy"] as const) {
      const current = subject[field];
      if (typeof current === "string" && HAIR_NOUNS.test(current)) {
        // Never leave the field blank — the clean-skin reinforcement has to
        // survive, since it's the only thing keeping markings out.
        subject[field] = dropClauses(current, HAIR_NOUNS) || CLEAN_SKIN;
      }
    }
  }
  if (overrides.makeup?.trim()) {
    subject.makeup = overrides.makeup.trim();
    const current = subject.description;
    if (typeof current === "string" && MAKEUP_NOUNS.test(current)) {
      subject.description = dropClauses(current, MAKEUP_NOUNS) || CLEAN_SKIN;
    }
  }
  if (overrides.chest?.trim()) {
    // Evict whatever the reference already claimed about the bust, or the two
    // statements disagree and the size is ignored (same trap as hair) — but
    // surgically, so build/waist/height survive verbatim.
    for (const field of ["description", "anatomy"] as const) {
      const current = subject[field];
      if (typeof current === "string" && CHEST_NOUNS.test(current)) {
        subject[field] = stripChestPhrases(current) || CLEAN_SKIN;
      }
    }
    // State the size in `anatomy` — the template's own body field. A bespoke
    // `chest` key would be ignored by anything that only knows the schema.
    const anatomy = typeof subject.anatomy === "string" ? subject.anatomy : "";
    const phrase = describeChestSize(overrides.chest);
    subject.anatomy = anatomy ? `${anatomy}, ${phrase}` : phrase;
  }
  if (overrides.butt?.trim()) {
    for (const field of ["description", "anatomy"] as const) {
      const current = subject[field];
      if (typeof current === "string" && BUTT_NOUNS.test(current)) {
        subject[field] = stripButtPhrases(current) || CLEAN_SKIN;
      }
    }
    const anatomy = typeof subject.anatomy === "string" ? subject.anatomy : "";
    const phrase = describeButtSize(overrides.butt);
    subject.anatomy = anatomy ? `${anatomy}, ${phrase}` : phrase;
  }
  // No size given at all → say nothing about the body and let the LoRA supply
  // it. Runs last so it can never undo an explicit size above.
  if (overrides.bodyFromLora && !overrides.chest?.trim() && !overrides.butt?.trim()) {
    for (const field of ["description", "anatomy"] as const) {
      const current = subject[field];
      if (typeof current === "string" && BODY_SHAPE_NOUNS.test(current)) {
        subject[field] = stripBodyShape(current) || CLEAN_SKIN;
      }
    }
  }
  if (Object.keys(subject).length > 0) parsed.subject = subject;

  // ── Pose ──
  // The pose the prompt was written from is spelled out across six fields, and
  // the Higgsfield flattener concatenates all of them (`toHiggsfieldPrompt`).
  // Writing only `type` would leave the old arms/legs/spine describing the
  // posture we just replaced, so the model reads two contradictory poses and
  // the detailed one wins — the same failure mode as hair vs. description.
  // Drop the detail fields and let the override speak alone.
  if (overrides.pose?.trim()) {
    const pose = (parsed.pose as Json) ?? {};
    pose.type = overrides.pose.trim();
    // `expression` is deliberately kept: it's the face, not the posture.
    for (const field of ["orientation", "arms", "legs", "spine"]) {
      delete pose[field];
    }
    parsed.pose = pose;
  }

  if (overrides.background?.trim()) {
    const env = (parsed.environment as Json) ?? {};
    env.location = overrides.background.trim();
    parsed.environment = env;
  }

  return JSON.stringify(parsed, null, 2);
}

// A short human label for a saved prompt, pulled from its JSON — used as the
// default name when saving a preset from the Stills step.
export function describePromptBriefly(prompt: string): string {
  try {
    const parsed = JSON.parse(prompt) as Json;
    const pose = parsed.pose as Json | undefined;
    const bits = [pose?.type, pose?.orientation]
      .filter((v): v is string => typeof v === "string" && v.length > 0)
      .join(", ");
    return bits.slice(0, 60);
  } catch {
    return "";
  }
}
