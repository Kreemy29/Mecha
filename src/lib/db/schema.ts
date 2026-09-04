import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

export const characters = sqliteTable("characters", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  featureProfile: text("feature_profile").notNull(),
  higgsFieldCharacterRef: text("higgsfield_character_ref"),
  baseImagePath: text("base_image_path"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
});

export const presets = sqliteTable("presets", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  description: text("description"),
  type: text("type", { enum: ["image", "video"] }).notNull(),
  searchPromptSeed: text("search_prompt_seed").notNull(),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
});

export const batches = sqliteTable("batches", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  type: text("type", {
    enum: ["image", "talking_head", "motion_capture"],
  }).notNull(),
  characterId: integer("character_id").references(() => characters.id),
  status: text("status", {
    enum: ["pending", "running", "completed", "failed"],
  })
    .notNull()
    .default("pending"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
});

export const references = sqliteTable("references", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  batchId: integer("batch_id").references(() => batches.id),
  sourceUrl: text("source_url"),
  sourceKind: text("source_kind", {
    enum: ["pinterest", "instagram", "manual"],
  }),
  localPath: text("local_path"),
  framePath: text("frame_path"),
  selected: integer("selected", { mode: "boolean" }).notNull().default(false),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
});

export const jobs = sqliteTable("jobs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  batchId: integer("batch_id").references(() => batches.id),
  characterId: integer("character_id").references(() => characters.id),
  referenceId: integer("reference_id").references(() => references.id),
  kind: text("kind", {
    enum: ["image", "talking_head", "motion_capture", "seedance"],
  }).notNull(),
  status: text("status", {
    enum: [
      "queued",
      "running",
      "polling",
      "succeeded",
      "failed",
      "filtered",
      "rejected",
    ],
  })
    .notNull()
    .default("queued"),
  provider: text("provider", {
    enum: [
      "higgsfield",
      "runninghub",
      "fal",
      "dummy",
      "seedance",
      "kie",
      "kling",
    ],
  }),
  providerModel: text("provider_model"),
  providerParams: text("provider_params", { mode: "json" }).$type<{
    quality?: string;
    aspectRatio?: string;
    enhancePrompt?: boolean;
    sceneRefUrl?: string;
    // Wan Animate (runninghub) inputs:
    seconds?: number;
    // Kling 3.0 Motion Control (higgsfield motion_control) inputs:
    resolution?: string; // "720p" | "1080p"
    sceneControl?: string; // "image" (keep the still's backdrop) | "video"
    animateImagePath?: string; // approved recreated still
    animateVideoPath?: string; // original driving video
    // Seedance (higgsfield generate_video) inputs:
    seedanceImagePath?: string; // approved recreated still (@Image1)
    seedanceVideoPath?: string; // reference video (@Video1)
    duration?: number;
    outfit?: string; // the dress this variant was generated for
    // Explicit reference images (paths or URLs) passed to the model as medias.
    // Used by the nano-banana background swap: [subject still, new background].
    mediaRefs?: string[];
  }>(),
  providerJobId: text("provider_job_id"),
  prompt: text("prompt"),
  promptHistory: text("prompt_history", { mode: "json" }).$type<
    Array<{
      prompt: string;
      outputPath?: string;
      rejectionNote?: string;
      timestamp: string;
    }>
  >(),
  attempts: integer("attempts").notNull().default(0),
  outputPath: text("output_path"),
  error: text("error"),
  costEstimate: real("cost_estimate"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`(datetime('now'))`),
});

// Reusable backgrounds. The `description` is a FROZEN prompt fragment — it is
// injected verbatim as the scene's environment so the same backdrop renders
// identically on every generation (re-describing an image each time produced
// slightly different rooms).
export const backgrounds = sqliteTable("backgrounds", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  description: text("description").notNull(),
  imagePath: text("image_path"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
});

// OneUp accounts. Roles are assigned by an admin — nobody picks their own.
// `isAdmin` is separate from role on purpose: the first AI artist is an admin,
// later ones are not, so it can't be derived from the role.
export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  username: text("username").notNull().unique(),
  name: text("name").notNull(),
  role: text("role", {
    enum: ["owner", "ai_artist", "meta_ads", "marketing_manager"],
  }).notNull(),
  passwordHash: text("password_hash").notNull(),
  passwordSalt: text("password_salt").notNull(),
  isAdmin: integer("is_admin", { mode: "boolean" }).notNull().default(false),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
});

// Login sessions. The token is stored as a SHA-256 hash, so the database alone
// can't be used to impersonate a signed-in user.
export const sessions = sqliteTable("sessions", {
  tokenHash: text("token_hash").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
  expiresAt: text("expires_at").notNull(),
});

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

// A proven recreation prompt, frozen so it can be reused without re-running
// Grok. `prompt` is the full recreation JSON; outfit / hair / makeup /
// background are patched into it at use time (see lib/prompt-overrides.ts).
// The thumbnail is the video frame the prompt was written from, so the gallery
// is recognisable at a glance.
export const promptPresets = sqliteTable("prompt_presets", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  prompt: text("prompt").notNull(),
  thumbPath: text("thumb_path"),
  videoPath: text("video_path"),
  durationSeconds: real("duration_seconds"),
  notes: text("notes"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
});

// Reusable styling options, picked per batch like a background.
//   hair / makeup — single-valued; one of each may be flagged `isDefault` to
//                   preselect it.
//   outfit        — a library you pick several from; outfits multiply the
//                   variant matrix, so there's no single "default".
export const stylePresets = sqliteTable("style_presets", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  kind: text("kind", { enum: ["hair", "makeup", "outfit"] }).notNull(),
  name: text("name").notNull(),
  description: text("description").notNull(),
  isDefault: integer("is_default", { mode: "boolean" }).notNull().default(false),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
});

// Saved Instagram accounts ("models") browsed via services/instagram.ts's
// scraper client (see that file for which provider is currently wired up).
// These tables are created at runtime with CREATE TABLE IF NOT EXISTS (see
// ensureInstagramTables in services/instagram.ts) so adding them never
// requires a `db:push` (which can wipe hand-made data like backgrounds).
export const igAccounts = sqliteTable("ig_accounts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  username: text("username").notNull().unique(),
  igPk: text("ig_pk"),
  fullName: text("full_name"),
  biography: text("biography"),
  profilePicPath: text("profile_pic_path"),
  followerCount: integer("follower_count"),
  mediaCount: integer("media_count"),
  // Legacy single-value tags, superseded by igAccountTags (many-to-many).
  // Kept only so the one-time migration can read them; nothing writes here.
  modelName: text("model_name"),
  niche: text("niche"),
  lastSyncedAt: text("last_synced_at"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
});

// An account ↔ tag link. An account can carry any number of models AND any
// number of niches; saved media inherits its account's tags, which is how a
// clip shows up under every model/niche it belongs to.
export const igAccountTags = sqliteTable("ig_account_tags", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  accountId: integer("account_id")
    .notNull()
    .references(() => igAccounts.id),
  kind: text("kind", { enum: ["model", "niche"] }).notNull(),
  value: text("value").notNull(),
});

// Remembered model/niche values, so every one you type becomes a preset option
// on the next account. Kept separate from ig_accounts so an option survives
// deleting the last account that used it.
export const igTaxonomy = sqliteTable("ig_taxonomy", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  kind: text("kind", { enum: ["model", "niche"] }).notNull(),
  value: text("value").notNull(),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
});

// A saved clip handed to someone to produce, in one of two work queues.
// `assignedBy` is a free-text name for now — there is no login yet, so the
// operator says who they are and it is remembered in the browser. When auth
// lands this becomes the user id and nothing else here has to change.
export const igRequests = sqliteTable("ig_requests", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  mediaId: integer("media_id")
    .notNull()
    .references(() => igMedia.id),
  queue: text("queue", { enum: ["meta_ads", "reels"] }).notNull(),
  comment: text("comment"),
  // What to make it with: a model (persona) and/or a saved format. Both
  // optional — plenty of requests are just "recreate this".
  model: text("model"),
  formatId: integer("format_id"),
  assignedBy: text("assigned_by").notNull(),
  status: text("status", { enum: ["open", "done"] })
    .notNull()
    .default("open"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
});

// Replies on a request — the back-and-forth between whoever assigned a clip
// and whoever is producing it. `author` is a free-text name for the same
// reason as igRequests.assignedBy: no login yet.
export const igRequestComments = sqliteTable("ig_request_comments", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  requestId: integer("request_id")
    .notNull()
    .references(() => igRequests.id),
  author: text("author").notNull(),
  body: text("body").notNull(),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
});

// Reference examples of what "good" looks like for a queue — the clips worth
// copying. Either an uploaded file or an Instagram link; both end up with a
// local video so they can be watched without leaving the page.
export const winningFormats = sqliteTable("winning_formats", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  queue: text("queue", { enum: ["meta_ads", "reels"] }).notNull(),
  title: text("title").notNull(),
  videoPath: text("video_path"),
  thumbPath: text("thumb_path"),
  // The original reel, kept even after download so it can be opened on
  // Instagram (view counts and comments are the point of the reference).
  sourceUrl: text("source_url"),
  shortcode: text("shortcode"),
  notes: text("notes"),
  addedBy: text("added_by"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
});

// Media items the operator chose to keep. Thumbnail is cached locally at save
// time (IG CDN URLs expire); the video itself is only downloaded on demand
// ("Recreate" → Seedance / Motion Capture, or explicit download).
export const igMedia = sqliteTable("ig_media", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  accountId: integer("account_id").references(() => igAccounts.id),
  shortcode: text("shortcode").notNull().unique(),
  igPk: text("ig_pk"),
  caption: text("caption"),
  thumbPath: text("thumb_path"),
  videoPath: text("video_path"),
  playCount: integer("play_count"),
  likeCount: integer("like_count"),
  commentCount: integer("comment_count"),
  takenAt: integer("taken_at"),
  durationSeconds: real("duration_seconds"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
});
