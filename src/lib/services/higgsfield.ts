import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import fs from "fs";
import path from "path";
import { readMediaBytes } from "../local-files";

const MCP_URL = process.env.HIGGSFIELD_MCP_URL || "https://mcp.higgsfield.ai";
const TOKEN_ENDPOINT = `${MCP_URL}/oauth2/token`;
const TOKEN_PATH = path.resolve("./data/higgsfield-token.json");
// Public client registered during the PKCE flow (token_endpoint_auth_method: none).
const CLIENT_ID = process.env.HIGGSFIELD_CLIENT_ID || "p5Y4QJiKYywp7Mwh";
// Refresh when within this window of expiry.
const REFRESH_SKEW_MS = 5 * 60 * 1000;

interface OAuthTokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  clientId?: string;
}

// ── Token persistence ──

function loadTokens(): OAuthTokens | null {
  try {
    if (fs.existsSync(TOKEN_PATH)) {
      return JSON.parse(fs.readFileSync(TOKEN_PATH, "utf-8"));
    }
  } catch {
    // corrupt file
  }
  return null;
}

function saveTokens(tokens: OAuthTokens): void {
  const dir = path.dirname(TOKEN_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2));
}

// ── Token refresh (refresh_token grant) ──

async function refreshAccessToken(tokens: OAuthTokens): Promise<OAuthTokens> {
  if (!tokens.refreshToken) {
    throw new Error("Token expired and no refresh_token available — re-run auth");
  }
  const clientId = tokens.clientId || CLIENT_ID;
  console.log("[Higgsfield] Refreshing access token...");

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: tokens.refreshToken,
    client_id: clientId,
    resource: MCP_URL,
  });

  const res = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!res.ok) {
    throw new Error(`Token refresh failed (${res.status}): ${await res.text()}`);
  }

  const t = await res.json();
  const refreshed: OAuthTokens = {
    accessToken: t.access_token,
    refreshToken: t.refresh_token || tokens.refreshToken,
    expiresAt: t.expires_in
      ? Date.now() + t.expires_in * 1000
      : Date.now() + 24 * 60 * 60 * 1000,
    clientId,
  };
  saveTokens(refreshed);
  console.log("[Higgsfield] Token refreshed");
  return refreshed;
}

async function getValidAccessToken(): Promise<string | null> {
  let tokens = loadTokens();

  if (tokens?.accessToken) {
    const expired =
      tokens.expiresAt !== undefined &&
      Date.now() > tokens.expiresAt - REFRESH_SKEW_MS;
    if (expired) {
      try {
        tokens = await refreshAccessToken(tokens);
      } catch (err) {
        // The web process and the worker process share this token file but
        // not memory. Higgsfield's refresh_token is single-use and rotates,
        // so when both see the token as expired around the same time, only
        // the first refresh succeeds — the second's refresh_token is already
        // consumed and gets rejected. Re-read the file: if the other process
        // won the race, use what it wrote instead of going unauthenticated.
        const latest = loadTokens();
        if (latest?.accessToken && latest.refreshToken !== tokens.refreshToken) {
          return latest.accessToken;
        }
        console.error("[Higgsfield]", err);
        return null;
      }
    }
    return tokens.accessToken;
  }

  // Fallback: manually pasted env token
  return process.env.HIGGSFIELD_OAUTH_TOKEN || null;
}

// ── MCP Client singleton ──

let mcpClient: Client | null = null;
let mcpTransport: StreamableHTTPClientTransport | null = null;
let connectedWithToken: string | null = null;

export async function getHiggsFieldClient(): Promise<Client> {
  const accessToken = await getValidAccessToken();

  // Reuse the existing connection unless the token changed (e.g. after refresh).
  if (mcpClient && connectedWithToken === accessToken) return mcpClient;

  // Token changed — tear down the stale connection.
  if (mcpClient) {
    try {
      await mcpClient.close();
    } catch {
      // ignore
    }
    mcpClient = null;
    mcpTransport = null;
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (accessToken) headers["Authorization"] = `Bearer ${accessToken}`;

  const transport = new StreamableHTTPClientTransport(new URL(`${MCP_URL}/mcp`), {
    requestInit: { headers },
  });

  const client = new Client({ name: "mecha-ai", version: "1.0.0" });
  await client.connect(transport);

  mcpClient = client;
  mcpTransport = transport;
  connectedWithToken = accessToken;

  console.log("[Higgsfield] Connected to MCP server");
  return client;
}

export function disconnectHiggsField(): void {
  if (mcpClient) {
    mcpClient.close();
    mcpClient = null;
    mcpTransport = null;
    connectedWithToken = null;
  }
}

// ── Tool discovery ──

export interface McpTool {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

export async function listTools(): Promise<McpTool[]> {
  const client = await getHiggsFieldClient();
  const result = await client.listTools();
  return (result.tools || []).map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema as Record<string, unknown>,
  }));
}

export async function callTool(
  name: string,
  args: Record<string, unknown>
): Promise<unknown> {
  const client = await getHiggsFieldClient();
  const result = await client.callTool({ name, arguments: args });
  return result;
}

// ── Character operations ──

export interface HiggsFieldCharacter {
  id: string;
  name: string;
  imageUrl?: string;
  status?: string;
}

// The Higgsfield MCP exposes characters via the `show_characters` tool.
// Verified live response shape:
//   { items: [ { id, soul_id, name, type, status, url, thumbnail_url, preview_url } ], next_cursor }
const SHOW_CHARACTERS_TOOL = "show_characters";

interface HfCharacterItem {
  id?: string;
  soul_id?: string;
  name?: string;
  type?: string;
  status?: string;
  url?: string;
  thumbnail_url?: string;
  preview_url?: string;
}

export async function listCharacters(
  status: "ready" | "training" | "failed" = "ready"
): Promise<HiggsFieldCharacter[]> {
  try {
    const client = await getHiggsFieldClient();

    const characters: HiggsFieldCharacter[] = [];
    let cursor: number | undefined = undefined;

    // Paginate through all characters
    do {
      const args: Record<string, unknown> = {
        action: "list",
        status,
        type: "soul_2",
        size: 100,
      };
      if (cursor !== undefined) args.cursor = cursor;

      const result = await client.callTool({
        name: SHOW_CHARACTERS_TOOL,
        arguments: args,
      });

      cursor = undefined;

      const content = result.content as
        | Array<{ type: string; text?: string }>
        | undefined;
      if (!content || !Array.isArray(content)) break;

      for (const item of content) {
        if (item.type === "text" && typeof item.text === "string") {
          try {
            const parsed = JSON.parse(item.text);
            const items: HfCharacterItem[] = Array.isArray(parsed)
              ? parsed
              : parsed.items || [];

            for (const c of items) {
              characters.push({
                id: String(c.soul_id || c.id || ""),
                name: String(c.name || ""),
                imageUrl: c.url || c.thumbnail_url || c.preview_url || undefined,
                status: c.status,
              });
            }

            if (typeof parsed.next_cursor === "number") {
              cursor = parsed.next_cursor;
            }
          } catch {
            // not JSON, skip
          }
        }
      }
    } while (cursor !== undefined);

    console.log(`[Higgsfield] Pulled ${characters.length} characters`);
    return characters;
  } catch (err) {
    console.error("[Higgsfield] listCharacters error:", err);
    throw err;
  }
}

// ── Generate with Higgsfield ──

// Verified tools:
//   generate_image → { params: { model, prompt, soul_id?, aspect_ratio?, count?, get_cost? } }
//   job_display    → { results: [{ id, status, results: { rawUrl, minUrl }, model, params }] }
// For a trained Soul: model "soul_2" + soul_id. Output to download is results.rawUrl.
const GENERATE_IMAGE_TOOL = "generate_image";
const GENERATE_VIDEO_TOOL = "generate_video";
const JOB_DISPLAY_TOOL = "job_display";
// Kling 3.0 Motion Control — the Higgsfield alternative to RunningHub's Wan
// Animate. Verified schema: { params: { image_id, motion_video_id,
// resolution: 720p|1080p, scene_control: image|video } }. Takes NO prompt and
// no count; the scene is derived from whichever source scene_control names.
const MOTION_CONTROL_TOOL = "motion_control";

const UUID_RE =
  /[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/gi;

interface ToolCallResult {
  structuredContent?: Record<string, unknown>;
  content?: Array<{ type: string; text?: string }>;
  isError?: boolean;
}

// Pull the first parseable JSON object out of an MCP tool result's content[].
function parseToolJson(result: ToolCallResult): Record<string, unknown> | null {
  if (result.structuredContent) return result.structuredContent;
  if (Array.isArray(result.content)) {
    for (const item of result.content) {
      if (item.type === "text" && item.text) {
        try {
          return JSON.parse(item.text);
        } catch {
          // not JSON
        }
      }
    }
  }
  return null;
}

const MEDIA_UPLOAD_TOOL = "media_upload";
const MEDIA_CONFIRM_TOOL = "media_confirm";

// Read image bytes from an http(s) URL or a local path.
async function readImageBytes(src: string): Promise<Buffer> {
  if (src.startsWith("http")) {
    // Our own /api/files links resolve to disk — the worker is a separate
    // process, so an HTTP fetch here arrives without a session cookie.
    return readMediaBytes(src);
  }
  // local path (relative to cwd)
  const abs =
    src.startsWith("/") || /^[A-Za-z]:/.test(src) ? src : `${process.cwd()}/${src}`;
  return fs.readFileSync(abs);
}

function detectMime(buf: Buffer): { mime: string; ext: string } {
  if (buf[0] === 0x89 && buf[1] === 0x50) return { mime: "image/png", ext: "png" };
  if (buf[0] === 0x52 && buf[1] === 0x49 && buf[8] === 0x57)
    return { mime: "image/webp", ext: "webp" };
  if (buf[0] === 0x47 && buf[1] === 0x49) return { mime: "image/gif", ext: "gif" };
  return { mime: "image/jpeg", ext: "jpg" };
}

// Upload an image (by URL or local path) to Higgsfield and return its media_id.
// Required because Higgsfield's fetcher rejects CloudFront's bad content-type,
// so we must inline the bytes via the presigned upload flow.
export async function uploadImageToHiggsfield(src: string): Promise<string> {
  const bytes = await readImageBytes(src);
  const { mime, ext } = detectMime(bytes);

  const upRes = (await callTool(MEDIA_UPLOAD_TOOL, {
    filename: `ref_${Date.now()}.${ext}`,
    content_type: mime,
  })) as ToolCallResult;
  const upParsed = parseToolJson(upRes);
  const upload = (upParsed?.uploads as Array<Record<string, string>>)?.[0];
  if (!upload?.upload_url || !upload?.media_id) {
    throw new Error(`media_upload returned no presigned URL: ${JSON.stringify(upParsed)}`);
  }

  // PUT the bytes (content-type must match the signed header)
  const put = await fetch(upload.upload_url, {
    method: "PUT",
    headers: { "Content-Type": mime },
    // Uint8Array, not Buffer — fetch's BodyInit doesn't accept a Node Buffer
    // (the video upload below already does it this way).
    body: new Uint8Array(bytes),
  });
  if (!put.ok) {
    throw new Error(`Media PUT failed (${put.status}): ${await put.text()}`);
  }

  await callTool(MEDIA_CONFIRM_TOOL, {
    media_id: upload.media_id,
    type: "image",
  });

  console.log(`[Higgsfield] Uploaded media ${upload.media_id} (${mime})`);
  return upload.media_id;
}

export interface SubmitImageOptions {
  model?: string;
  soulId?: string;
  aspectRatio?: string;
  quality?: string;
  enhancePrompt?: boolean;
  // Reference images (URLs or local paths) — uploaded and passed as medias[].
  mediaRefs?: string[];
}

// Submit an image generation. Returns the provider job id (one image per job).
export async function submitImageJob(
  prompt: string,
  options?: SubmitImageOptions
): Promise<{ jobId: string }> {
  const params: Record<string, unknown> = {
    model: options?.model || "soul_2",
    prompt,
    count: 1,
  };
  if (options?.soulId) params.soul_id = options.soulId;
  if (options?.aspectRatio) params.aspect_ratio = options.aspectRatio;
  if (options?.quality) params.quality = options.quality;
  if (options?.enhancePrompt !== undefined)
    params.enhance_prompt = options.enhancePrompt;

  // Upload reference images and attach as medias[].
  if (options?.mediaRefs && options.mediaRefs.length > 0) {
    const medias: Array<{ value: string; role: string }> = [];
    for (const ref of options.mediaRefs) {
      try {
        const mediaId = await uploadImageToHiggsfield(ref);
        medias.push({ value: mediaId, role: "image" });
      } catch (err) {
        console.error(`[Higgsfield] Failed to upload reference ${ref}:`, err);
      }
    }
    // Fail loudly rather than generating with a partial reference set — a
    // missing reference silently produces a completely wrong image.
    if (medias.length !== options.mediaRefs.length) {
      throw new Error(
        `Reference upload incomplete: ${medias.length}/${options.mediaRefs.length} images uploaded. Refusing to generate with a partial reference set.`
      );
    }
    params.medias = medias;
    console.log(`[Higgsfield] Attached ${medias.length} reference image(s)`);
  }

  // Debug dump: exactly what we sent (incl. medias) — so reference-image issues
  // are diagnosable without guessing.
  try {
    fs.writeFileSync(
      "./data/debug-generate-image.json",
      JSON.stringify({ params }, null, 2)
    );
  } catch {
    // non-fatal
  }

  const result = (await callTool(GENERATE_IMAGE_TOOL, { params })) as ToolCallResult;

  if (result.isError) {
    throw new Error(
      `generate_image error: ${JSON.stringify(result.content || result)}`
    );
  }

  const parsed = parseToolJson(result);

  // Common shapes: { id }, { job_id }, { jobs: [{id}] }, { results: [{id}] }
  if (parsed) {
    const direct = parsed.job_id || parsed.id || parsed.task_id;
    if (direct) return { jobId: String(direct) };

    const arr =
      (parsed.jobs as Array<{ id?: string }>) ||
      (parsed.results as Array<{ id?: string }>) ||
      (parsed.items as Array<{ id?: string }>);
    if (Array.isArray(arr) && arr[0]?.id) return { jobId: String(arr[0].id) };
  }

  // Last resort: scrape a UUID from the raw result text.
  const raw = JSON.stringify(result);
  const match = raw.match(UUID_RE);
  if (match && match[0]) return { jobId: match[0] };

  throw new Error(
    `Could not extract job id from generate_image response: ${raw.slice(0, 400)}`
  );
}

export interface JobStatusResult {
  status: "running" | "succeeded" | "failed" | "filtered";
  rawUrl?: string;
  error?: string;
}

const TERMINAL_OK = new Set(["completed", "succeeded", "success", "done"]);
const TERMINAL_FILTERED = new Set([
  "nsfw",
  "content_moderation",
  "moderated",
  "rejected",
  "filtered",
  "blocked",
]);
const TERMINAL_FAIL = new Set(["failed", "error", "canceled", "cancelled"]);

// Poll a single job by id via job_display (the "Check Job Status" tool).
export async function checkJob(jobId: string): Promise<JobStatusResult> {
  const result = (await callTool(JOB_DISPLAY_TOOL, { id: jobId })) as ToolCallResult;
  const parsed = parseToolJson(result);

  // Shape: { results: [{ id, status, results: { rawUrl, minUrl } }] }
  const job =
    (parsed?.results as Array<Record<string, unknown>> | undefined)?.[0] ||
    parsed;
  if (!job) return { status: "running" };

  const status = String(job.status || "").toLowerCase();
  const inner = job.results as { rawUrl?: string; minUrl?: string } | undefined;

  if (TERMINAL_OK.has(status)) {
    const rawUrl = inner?.rawUrl || inner?.minUrl;
    if (rawUrl) return { status: "succeeded", rawUrl };
    return { status: "failed", error: "Completed but no output URL" };
  }
  if (TERMINAL_FILTERED.has(status)) {
    return { status: "filtered", error: `Content filtered (${status})` };
  }
  if (TERMINAL_FAIL.has(status)) {
    return { status: "failed", error: `Job ${status}` };
  }
  return { status: "running" };
}

// ── Seedance video generation (generate_video) ──

// Upload a local video file to Higgsfield and return its media_id (same
// presigned flow as images, but confirmed as type "video").
export async function uploadVideoToHiggsfield(src: string): Promise<string> {
  const bytes = await readImageBytes(src); // reads any file's bytes
  const mime = "video/mp4";

  const upRes = (await callTool(MEDIA_UPLOAD_TOOL, {
    filename: `ref_${Date.now()}.mp4`,
    content_type: mime,
  })) as ToolCallResult;
  const upParsed = parseToolJson(upRes);
  const upload = (upParsed?.uploads as Array<Record<string, string>>)?.[0];
  if (!upload?.upload_url || !upload?.media_id) {
    throw new Error(`media_upload returned no presigned URL: ${JSON.stringify(upParsed)}`);
  }

  const put = await fetch(upload.upload_url, {
    method: "PUT",
    headers: { "Content-Type": mime },
    body: new Uint8Array(bytes),
  });
  if (!put.ok) {
    throw new Error(`Video PUT failed (${put.status}): ${await put.text()}`);
  }

  await callTool(MEDIA_CONFIRM_TOOL, { media_id: upload.media_id, type: "video" });
  console.log(`[Higgsfield] Uploaded video media ${upload.media_id}`);
  return upload.media_id;
}

export interface SubmitVideoOptions {
  model?: string;
  imageMediaId: string; // @Image1 — the recreated still (identity + outfit)
  // @Video1 — the reference video (motion + framing). Omitted for
  // image-to-video, where the prompt alone carries the motion.
  videoMediaId?: string;
  aspectRatio?: string;
  duration?: number;
  imageRole?: string;
  videoRole?: string;
}

// Submit a Seedance video-to-video job. Returns the provider job id.
export async function submitVideoJob(
  prompt: string,
  options: SubmitVideoOptions
): Promise<{ jobId: string }> {
  // Verified via models_explore: id "seedance_2_0", media roles
  // image_references / video_references, duration 4-15s.
  const model =
    options.model || process.env.HIGGSFIELD_SEEDANCE_MODEL || "seedance_2_0";
  const imageRole =
    options.imageRole ||
    process.env.HIGGSFIELD_SEEDANCE_IMAGE_ROLE ||
    "image_references";
  const videoRole =
    options.videoRole ||
    process.env.HIGGSFIELD_SEEDANCE_VIDEO_ROLE ||
    "video_references";

  const params: Record<string, unknown> = {
    model,
    prompt,
    medias: [
      { value: options.imageMediaId, role: imageRole },
      ...(options.videoMediaId
        ? [{ value: options.videoMediaId, role: videoRole }]
        : []),
    ],
  };
  if (options.aspectRatio) params.aspect_ratio = options.aspectRatio;
  // Seedance 2.0 accepts 4-15s — clamp so auto-matched source durations submit.
  if (options.duration)
    params.duration = Math.min(15, Math.max(4, Math.round(options.duration)));

  console.log(`[Higgsfield] Submitting generate_video (${model})`);
  let result = (await callTool(GENERATE_VIDEO_TOOL, { params })) as ToolCallResult & {
    structuredContent?: Record<string, unknown>;
  };
  if (result.isError) {
    throw new Error(
      `generate_video error: ${JSON.stringify(result.content || result)}`
    );
  }

  // Higgsfield may interrupt the submission with a "preset recommendation"
  // (no job submitted!) when the prompt resembles a preset. We always generate
  // literally: decline the preset and resubmit.
  const notice = result.structuredContent?.notice as
    | { type?: string; data?: { preset?: { id?: string; name?: string } } }
    | undefined;
  if (notice?.type === "preset_recommendation" && notice.data?.preset?.id) {
    console.log(
      `[Higgsfield] Preset recommendation intercepted ("${notice.data.preset.name}") — declining, generating literally`
    );
    params.declined_preset_id = notice.data.preset.id;
    result = (await callTool(GENERATE_VIDEO_TOOL, { params })) as ToolCallResult & {
      structuredContent?: Record<string, unknown>;
    };
    if (result.isError) {
      throw new Error(
        `generate_video error (after preset decline): ${JSON.stringify(result.content || result)}`
      );
    }
  }

  // Debug dump: capture the raw response shape so id-extraction issues can be
  // diagnosed offline (worker console isn't always visible).
  try {
    fs.writeFileSync(
      "./data/debug-generate-video.json",
      JSON.stringify(result, null, 2)
    );
  } catch {
    // non-fatal
  }

  // Try content[] JSON first, then structuredContent (some tools only use it).
  for (const parsed of [parseToolJson(result), result.structuredContent]) {
    if (!parsed) continue;
    const direct = parsed.job_id || parsed.id || parsed.task_id;
    if (direct) return { jobId: String(direct) };
    const arr =
      (parsed.jobs as Array<{ id?: string }>) ||
      (parsed.results as Array<{ id?: string }>) ||
      (parsed.items as Array<{ id?: string }>);
    if (Array.isArray(arr) && arr[0]?.id) return { jobId: String(arr[0].id) };
  }

  // Last resort: scrape a UUID — but NEVER the media ids we just submitted
  // (Higgsfield dedupes identical uploads, so a media id echoed in the response
  // is stable across submissions and absolutely not a job id).
  const raw = JSON.stringify(result);
  const exclude = new Set(
    [options.imageMediaId, options.videoMediaId].filter(Boolean)
  );
  const uuids = raw.match(new RegExp(UUID_RE.source, "gi")) || [];
  const candidate = uuids.find((u) => !exclude.has(u));
  if (candidate) {
    console.warn(
      `[Higgsfield] generate_video: job id scraped from raw response (${candidate}) — response shape: ${raw.slice(0, 300)}`
    );
    return { jobId: candidate };
  }

  throw new Error(
    `Could not extract job id from generate_video response: ${raw.slice(0, 400)}`
  );
}

// ── Kling 3.0 Motion Control (motion_control) ──

export interface SubmitMotionControlOptions {
  imageMediaId: string; // the approved character still
  videoMediaId: string; // the driving motion clip
  resolution?: "720p" | "1080p";
  // Where the background comes from: the still ("image") or the driving clip
  // ("video"). "image" keeps the backdrop we generated, which is what the
  // recreation pipeline wants — the still already carries the chosen setting.
  sceneControl?: "image" | "video";
}

export async function submitMotionControlJob(
  options: SubmitMotionControlOptions
): Promise<{ jobId: string }> {
  const params: Record<string, unknown> = {
    image_id: options.imageMediaId,
    motion_video_id: options.videoMediaId,
    resolution: options.resolution || "720p",
    scene_control: options.sceneControl || "image",
  };

  console.log(
    `[Higgsfield] Submitting motion_control (Kling 3.0, ${params.resolution}, scene=${params.scene_control})`
  );
  const result = (await callTool(MOTION_CONTROL_TOOL, { params })) as ToolCallResult & {
    structuredContent?: Record<string, unknown>;
  };
  if (result.isError) {
    throw new Error(
      `motion_control error: ${JSON.stringify(result.content || result)}`
    );
  }

  // Same extraction ladder as generate_video: content[] JSON, then
  // structuredContent, then a UUID scrape that must never return one of the
  // media ids we just submitted (Higgsfield echoes those back).
  for (const parsed of [parseToolJson(result), result.structuredContent]) {
    if (!parsed) continue;
    const direct = parsed.job_id || parsed.id || parsed.task_id;
    if (direct) return { jobId: String(direct) };
    const arr =
      (parsed.jobs as Array<{ id?: string }>) ||
      (parsed.results as Array<{ id?: string }>) ||
      (parsed.items as Array<{ id?: string }>);
    if (Array.isArray(arr) && arr[0]?.id) return { jobId: String(arr[0].id) };
  }

  const raw = JSON.stringify(result);
  const exclude = new Set(
    [options.imageMediaId, options.videoMediaId].filter(Boolean)
  );
  const candidate = (raw.match(new RegExp(UUID_RE.source, "gi")) || []).find(
    (u) => !exclude.has(u)
  );
  if (candidate) {
    console.warn(
      `[Higgsfield] motion_control: job id scraped from raw response (${candidate})`
    );
    return { jobId: candidate };
  }

  throw new Error(
    `Could not extract job id from motion_control response: ${raw.slice(0, 400)}`
  );
}

// ── Eligibility: credits balance + cost preflight ──

// Pull the first number out of a tool result (json fields or raw text).
function extractNumber(
  parsed: Record<string, unknown> | null,
  raw: unknown,
  keys: string[]
): number | null {
  if (parsed) {
    for (const k of keys) {
      const v = parsed[k];
      if (typeof v === "number") return v;
      if (typeof v === "string" && /^\d+(\.\d+)?$/.test(v)) return parseFloat(v);
    }
  }
  const text = JSON.stringify(raw ?? "");
  const m = text.match(/(\d+(?:\.\d+)?)\s*credits?/i) || text.match(/"(?:cost|credits|balance)"\s*:\s*(\d+(?:\.\d+)?)/i);
  return m ? parseFloat(m[1]) : null;
}

// Current credits balance (null if the shape is unrecognized — don't block).
export async function getCreditsBalance(): Promise<number | null> {
  try {
    const res = (await callTool("balance", {})) as ToolCallResult & {
      structuredContent?: Record<string, unknown>;
    };
    const parsed = parseToolJson(res) || res.structuredContent || null;
    return extractNumber(parsed as Record<string, unknown> | null, res, [
      "credits",
      "balance",
      "available_credits",
      "available",
    ]);
  } catch {
    return null;
  }
}

// Credit cost of a video generation without submitting it (get_cost: true).
export async function estimateVideoJobCost(
  prompt: string,
  options: SubmitVideoOptions
): Promise<number | null> {
  try {
    const model =
      options.model || process.env.HIGGSFIELD_SEEDANCE_MODEL || "seedance_2_0";
    const imageRole =
      options.imageRole ||
      process.env.HIGGSFIELD_SEEDANCE_IMAGE_ROLE ||
      "image_references";
    const videoRole =
      options.videoRole ||
      process.env.HIGGSFIELD_SEEDANCE_VIDEO_ROLE ||
      "video_references";
    const params: Record<string, unknown> = {
      model,
      prompt,
      get_cost: true,
      medias: [
        { value: options.imageMediaId, role: imageRole },
        ...(options.videoMediaId
          ? [{ value: options.videoMediaId, role: videoRole }]
          : []),
      ],
    };
    if (options.aspectRatio) params.aspect_ratio = options.aspectRatio;
    if (options.duration)
      params.duration = Math.min(15, Math.max(4, Math.round(options.duration)));

    const res = (await callTool(GENERATE_VIDEO_TOOL, { params })) as ToolCallResult & {
      structuredContent?: Record<string, unknown>;
    };
    const parsed = parseToolJson(res) || res.structuredContent || null;
    return extractNumber(parsed as Record<string, unknown> | null, res, [
      "cost",
      "credits",
      "total_cost",
      "price",
    ]);
  } catch {
    return null;
  }
}

// Preflight the credit cost without submitting a job (get_cost: true).
export async function getImageCost(
  prompt: string,
  options?: SubmitImageOptions
): Promise<unknown> {
  const params: Record<string, unknown> = {
    model: options?.model || "soul_2",
    prompt,
    count: 1,
    get_cost: true,
  };
  if (options?.soulId) params.soul_id = options.soulId;
  if (options?.aspectRatio) params.aspect_ratio = options.aspectRatio;

  const result = (await callTool(GENERATE_IMAGE_TOOL, { params })) as ToolCallResult;
  return parseToolJson(result);
}

// ── OAuth helpers ──

export function getOAuthUrl(): string {
  // Higgsfield uses browser-based OAuth — direct user to their auth page
  return `${MCP_URL}/auth`;
}

export function saveOAuthToken(accessToken: string, refreshToken?: string): void {
  saveTokens({
    accessToken,
    refreshToken,
    expiresAt: Date.now() + 24 * 60 * 60 * 1000,
    clientId: CLIENT_ID,
  });
}

export function getConnectionStatus(): {
  connected: boolean;
  hasToken: boolean;
} {
  const tokens = loadTokens();
  const envToken = process.env.HIGGSFIELD_OAUTH_TOKEN;
  return {
    connected: mcpClient !== null,
    hasToken: !!(tokens?.accessToken || envToken),
  };
}
