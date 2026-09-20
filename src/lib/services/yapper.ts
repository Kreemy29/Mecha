import fs from "fs";
import path from "path";
import crypto from "crypto";
import { rawDb } from "../db";
import {
  type YapperAccount,
  accountIdForKey,
  getAccount,
  getActiveAccountId,
  listAccounts as listAccountRecords,
  upsertAccount,
} from "./yapper-accounts";

// Yapper (yapper.so) exposes a plain REST API keyed by a static API key —
// unlike Higgsfield's MCP server, there's no live tool call or OAuth session,
// just `Authorization: Bearer yap_live_...` against yapper.so/api/v1.
const API_BASE = process.env.YAPPER_API_BASE || "https://yapper.so/api/v1";

function resolveAccountId(accountId?: string): string | null {
  return accountId || getActiveAccountId();
}

function getApiKey(accountId?: string): string | null {
  const id = resolveAccountId(accountId);
  if (!id) return process.env.YAPPER_API_KEY || null;
  const account = getAccount(id);
  return account?.apiKey || process.env.YAPPER_API_KEY || null;
}

async function yapperFetch(pathname: string, accountId?: string): Promise<unknown> {
  const apiKey = getApiKey(accountId);
  if (!apiKey) {
    throw new Error("No Yapper account connected — go to Settings to add an API key.");
  }
  const res = await fetch(`${API_BASE}${pathname}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Yapper API error (${res.status}): ${body}`);
  }
  return res.json();
}

// ── Generation history (browse past processes) ──
//
// Yapper's closest equivalent to Higgsfield's show_generations tool is
// GET /processes — one row per generation job, newest first, cursor-paginated.
// Normalized into the same Generation shape the Methods page already renders.

export interface GenerationMediaRef {
  role: string;
  url: string;
  type?: string;
}

export interface Generation {
  id: string;
  type: string; // "image" | "video" | "audio" — bucketed from Yapper's own process.type
  status: string;
  model: string;
  prompt: string;
  params: Record<string, unknown>;
  medias: GenerationMediaRef[];
  outputUrl: string | null;
  thumbnailUrl: string | null;
  createdAt: number | null; // unix seconds
}

export interface GenerationPage {
  items: Generation[];
  nextCursor: string | null;
}

interface RawProcessOutput {
  type?: string;
  assetId?: string | null;
  url?: string | null;
  thumbnailUrl?: string | null;
  mimeType?: string | null;
}

interface RawProcess {
  id: string;
  type: string; // e.g. "image-generation" | "video-generation" | "video-upscale" | ...
  status: string;
  model: string;
  input?: Record<string, unknown>;
  outputs?: RawProcessOutput[];
  createdAt: string;
}

// Yapper's process.type is a specific action ("image-generation",
// "video-upscale", "video-lipsync", ...) — bucket it down to the coarse
// image/video/audio split the Methods UI's toggle uses, same as Higgsfield's.
function bucketType(rawType: string): string {
  if (rawType.startsWith("image")) return "image";
  if (rawType.startsWith("video")) return "video";
  if (rawType.startsWith("audio")) return "audio";
  return rawType;
}

// Map the Methods UI's "video"/"image" toggle to Yapper's own process.type
// filter. Yapper only accepts one exact type per request (no wildcard/prefix
// match), so this only covers the primary generation types — upscale/lipsync
// variants won't be filtered in, matching Higgsfield's toggle which is also
// just video/image.
function toRawType(bucket: string): string | undefined {
  if (bucket === "video") return "video-generation";
  if (bucket === "image") return "image-generation";
  return undefined;
}

function normalizeGeneration(raw: RawProcess): Generation | null {
  if (!raw.id) return null;
  const outputs = raw.outputs || [];
  const primary = outputs.find((o) => o.url) || outputs[0];
  const input = raw.input || {};
  const { prompt: rawPrompt, ...restInput } = input;

  return {
    id: raw.id,
    type: bucketType(raw.type || ""),
    status: raw.status || "",
    model: raw.model || "",
    prompt: typeof rawPrompt === "string" ? rawPrompt : "",
    params: restInput,
    // Yapper's /processes response doesn't echo back reference-input assets
    // the way Higgsfield's params.medias does, so there's nothing to list here.
    medias: [],
    outputUrl: primary?.url || null,
    thumbnailUrl: primary?.thumbnailUrl || primary?.url || null,
    createdAt: raw.createdAt ? Math.floor(new Date(raw.createdAt).getTime() / 1000) : null,
  };
}

export async function listGenerations(
  cursor?: string,
  type?: "image" | "video" | "audio",
  accountId?: string
): Promise<GenerationPage> {
  const params = new URLSearchParams();
  params.set("limit", "20");
  if (cursor) params.set("cursor", cursor);
  const rawType = type ? toRawType(type) : undefined;
  if (rawType) params.set("type", rawType);

  const result = (await yapperFetch(`/processes?${params}`, accountId)) as {
    data?: RawProcess[];
    nextCursor?: string | null;
  };
  const items = result.data || [];

  return {
    items: items.map(normalizeGeneration).filter((g): g is Generation => !!g),
    nextCursor: result.nextCursor ?? null,
  };
}

// ── Saving specific generations permanently ──
// Same local-disk + SQLite pattern as Higgsfield's saveGeneration, in its own
// table (Yapper process ids and Higgsfield generation ids share no namespace).

const SAVED_GENERATIONS_DIR = path.resolve("./storage/yapper");

let savedGenerationsTableEnsured = false;
function ensureSavedGenerationsTable(): void {
  if (savedGenerationsTableEnsured) return;
  rawDb.exec(`
    CREATE TABLE IF NOT EXISTS saved_yapper_generations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      yapper_id TEXT NOT NULL UNIQUE,
      type TEXT NOT NULL,
      status TEXT NOT NULL,
      model TEXT NOT NULL,
      prompt TEXT NOT NULL,
      params TEXT NOT NULL,
      medias TEXT NOT NULL,
      output_path TEXT,
      thumbnail_path TEXT,
      generated_at REAL,
      saved_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  savedGenerationsTableEnsured = true;
}

export interface SavedGeneration {
  id: number;
  yapperId: string;
  type: string;
  status: string;
  model: string;
  prompt: string;
  params: Record<string, unknown>;
  medias: GenerationMediaRef[];
  outputPath: string | null;
  thumbnailPath: string | null;
  generatedAt: number | null;
  savedAt: string;
}

interface SavedGenerationRow {
  id: number;
  yapper_id: string;
  type: string;
  status: string;
  model: string;
  prompt: string;
  params: string;
  medias: string;
  output_path: string | null;
  thumbnail_path: string | null;
  generated_at: number | null;
  saved_at: string;
}

function rowToSaved(row: SavedGenerationRow): SavedGeneration {
  return {
    id: row.id,
    yapperId: row.yapper_id,
    type: row.type,
    status: row.status,
    model: row.model,
    prompt: row.prompt,
    params: JSON.parse(row.params),
    medias: JSON.parse(row.medias),
    outputPath: row.output_path,
    thumbnailPath: row.thumbnail_path,
    generatedAt: row.generated_at,
    savedAt: row.saved_at,
  };
}

async function downloadToStorage(url: string): Promise<string> {
  if (!fs.existsSync(SAVED_GENERATIONS_DIR)) {
    fs.mkdirSync(SAVED_GENERATIONS_DIR, { recursive: true });
  }
  const ext = path.extname(new URL(url).pathname) || ".bin";
  const key = crypto.createHash("sha1").update(url).digest("hex").slice(0, 24);
  const abs = path.join(SAVED_GENERATIONS_DIR, `${key}${ext}`);
  if (!fs.existsSync(abs)) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Download failed (${res.status}): ${url}`);
    fs.writeFileSync(abs, Buffer.from(await res.arrayBuffer()));
  }
  return path.relative(process.cwd(), abs);
}

export function listSavedGenerations(): SavedGeneration[] {
  ensureSavedGenerationsTable();
  const rows = rawDb
    .prepare("SELECT * FROM saved_yapper_generations ORDER BY generated_at DESC")
    .all() as SavedGenerationRow[];
  return rows.map(rowToSaved);
}

export function savedGenerationIds(): Set<string> {
  ensureSavedGenerationsTable();
  const rows = rawDb
    .prepare("SELECT yapper_id FROM saved_yapper_generations")
    .all() as Array<{ yapper_id: string }>;
  return new Set(rows.map((r) => r.yapper_id));
}

export async function saveGeneration(g: Generation): Promise<SavedGeneration> {
  ensureSavedGenerationsTable();
  const existing = rawDb
    .prepare("SELECT * FROM saved_yapper_generations WHERE yapper_id = ?")
    .get(g.id) as SavedGenerationRow | undefined;
  if (existing) return rowToSaved(existing);

  const outputPath = g.outputUrl ? await downloadToStorage(g.outputUrl) : null;
  const thumbnailPath =
    g.thumbnailUrl && g.thumbnailUrl !== g.outputUrl
      ? await downloadToStorage(g.thumbnailUrl)
      : outputPath;

  rawDb
    .prepare(
      `INSERT INTO saved_yapper_generations
        (yapper_id, type, status, model, prompt, params, medias, output_path, thumbnail_path, generated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      g.id,
      g.type,
      g.status,
      g.model,
      g.prompt,
      JSON.stringify(g.params),
      JSON.stringify(g.medias),
      outputPath,
      thumbnailPath,
      g.createdAt
    );

  const row = rawDb
    .prepare("SELECT * FROM saved_yapper_generations WHERE yapper_id = ?")
    .get(g.id) as SavedGenerationRow;
  return rowToSaved(row);
}

export function unsaveGeneration(yapperId: string): void {
  ensureSavedGenerationsTable();
  rawDb.prepare("DELETE FROM saved_yapper_generations WHERE yapper_id = ?").run(yapperId);
}

// ── Connecting an account (API key paste — Yapper has no OAuth for this) ──

export async function saveApiKey(apiKey: string, label?: string): Promise<void> {
  // Validate the key before storing it, same spirit as Higgsfield's connect
  // flow failing loudly on a bad token rather than silently keeping garbage.
  const res = await fetch(`${API_BASE}/credits`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) {
    throw new Error(`Yapper rejected this API key (${res.status})`);
  }
  const id = accountIdForKey(apiKey);
  const account: YapperAccount = {
    id,
    label: label || `Yapper key (${id.slice(0, 6)})`,
    apiKey,
  };
  upsertAccount(account, true);
}

export function getConnectionStatus(): {
  connected: boolean;
  hasToken: boolean;
  accounts: { id: string; label: string }[];
  activeAccountId: string | null;
} {
  const accounts = listAccountRecords();
  const envKey = process.env.YAPPER_API_KEY;
  return {
    connected: accounts.length > 0 || !!envKey,
    hasToken: accounts.length > 0 || !!envKey,
    accounts: accounts.map((a) => ({ id: a.id, label: a.label })),
    activeAccountId: getActiveAccountId(),
  };
}
