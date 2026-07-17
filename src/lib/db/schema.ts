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
    enum: ["higgsfield", "runninghub", "fal", "dummy", "seedance", "kie"],
  }),
  providerModel: text("provider_model"),
  providerParams: text("provider_params", { mode: "json" }).$type<{
    quality?: string;
    aspectRatio?: string;
    enhancePrompt?: boolean;
    sceneRefUrl?: string;
    // Wan Animate (runninghub) inputs:
    seconds?: number;
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

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});
