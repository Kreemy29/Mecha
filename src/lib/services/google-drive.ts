import crypto from "crypto";
import fs from "fs";
import path from "path";

// Google Drive through a service account: browse a Shared Drive for reference
// images, and file every image generated from the Images page under
//
//   <drive>/outputs/<model>/<YYYY-MM-DD>/<file>
//
// The service account is a robot Google user. It only sees Drives and folders
// shared with its client_email, and it has no storage of its own, so outputs
// must land in a Shared Drive (a folder in someone's My Drive refuses its
// uploads with a quota error).
//
// Env: GOOGLE_SERVICE_ACCOUNT_JSON, the whole key file on one line.
// Plain REST + a hand-signed JWT, so there's no googleapis dependency.

const API = "https://www.googleapis.com/drive/v3";
const UPLOAD_API = "https://www.googleapis.com/upload/drive/v3";
const SCOPE = "https://www.googleapis.com/auth/drive";
export const FOLDER_MIME = "application/vnd.google-apps.folder";
export const OUTPUTS_FOLDER = "outputs";

interface ServiceAccount {
  client_email: string;
  private_key: string;
  token_uri?: string;
}

function serviceAccount(): ServiceAccount | null {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim();
  if (!raw) return null;
  try {
    const sa = JSON.parse(raw) as ServiceAccount;
    return sa.client_email && sa.private_key ? sa : null;
  } catch {
    return null;
  }
}

export function driveConfigured(): { ok: boolean; email: string | null } {
  const sa = serviceAccount();
  return { ok: !!sa, email: sa?.client_email ?? null };
}

// ── Auth: JWT bearer grant, token cached until shortly before it expires ──

let cached: { token: string; exp: number } | null = null;

const b64url = (v: string | Buffer) => Buffer.from(v).toString("base64url");

async function accessToken(): Promise<string> {
  if (cached && Date.now() < cached.exp - 60_000) return cached.token;
  const sa = serviceAccount();
  if (!sa) throw new Error("Google Drive isn't set up (GOOGLE_SERVICE_ACCOUNT_JSON).");
  const tokenUri = sa.token_uri || "https://oauth2.googleapis.com/token";
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${b64url(
    JSON.stringify({ iss: sa.client_email, scope: SCOPE, aud: tokenUri, iat: now, exp: now + 3600 })
  )}`;
  const signature = crypto.createSign("RSA-SHA256").update(unsigned).sign(sa.private_key);
  const res = await fetch(tokenUri, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${unsigned}.${b64url(signature)}`,
    }),
  });
  const data = (await res.json()) as { access_token?: string; expires_in?: number; error_description?: string };
  if (!res.ok || !data.access_token) {
    throw new Error(`Google sign-in failed: ${data.error_description || res.status}`);
  }
  cached = { token: data.access_token, exp: Date.now() + (data.expires_in ?? 3600) * 1000 };
  return cached.token;
}

async function call<T>(url: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${await accessToken()}`, ...(init.headers || {}) },
    signal: init.signal ?? AbortSignal.timeout(60_000),
  });
  if (!res.ok) {
    let msg = `${res.status}`;
    try {
      const body = (await res.json()) as { error?: { message?: string } };
      msg = body.error?.message || msg;
    } catch {
      // not JSON
    }
    throw new Error(`Google Drive: ${msg}`);
  }
  return (await res.json()) as T;
}

const qs = (params: Record<string, string | number | boolean | undefined>) =>
  new URLSearchParams(
    Object.entries(params)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => [k, String(v)])
  ).toString();

// Drive query strings quote with single quotes.
const quote = (s: string) => `'${s.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;

// ── Browsing ──

export interface DriveRoot {
  id: string;
  name: string;
  kind: "shared_drive" | "folder";
}

// Every place the service account can work in: Shared Drives it's a member
// of, plus folders shared with it directly (inputs only; see the note above).
export async function listRoots(): Promise<DriveRoot[]> {
  const drives = await call<{ drives?: Array<{ id: string; name: string }> }>(
    `${API}/drives?${qs({ pageSize: 100 })}`
  );
  const folders = await call<{ files?: Array<{ id: string; name: string }> }>(
    `${API}/files?${qs({
      q: `sharedWithMe and mimeType = '${FOLDER_MIME}' and trashed = false`,
      fields: "files(id,name)",
      pageSize: 100,
      includeItemsFromAllDrives: true,
      supportsAllDrives: true,
    })}`
  );
  return [
    ...(drives.drives ?? []).map((d) => ({ id: d.id, name: d.name, kind: "shared_drive" as const })),
    ...(folders.files ?? []).map((f) => ({ id: f.id, name: f.name, kind: "folder" as const })),
  ];
}

// Whether outputs can be written under this root. Files the service account
// creates are owned by it, and it has no storage quota, so that only works
// inside a Shared Drive (where the drive owns the files).
export async function outputsCheck(rootId: string): Promise<{ ok: boolean; reason: string | null }> {
  const meta = await call<{ driveId?: string; capabilities?: { canAddChildren?: boolean } }>(
    `${API}/files/${encodeURIComponent(rootId)}?${qs({
      fields: "driveId,capabilities(canAddChildren)",
      supportsAllDrives: true,
    })}`
  );
  if (meta.capabilities?.canAddChildren === false) {
    return { ok: false, reason: "The service account can only view this folder. Share it as Editor or Content manager." };
  }
  if (!meta.driveId) {
    return {
      ok: false,
      reason:
        "This folder is in someone's My Drive. Google doesn't let a service account upload there (it has no storage). Move it into a Shared Drive, or pick one.",
    };
  }
  return { ok: true, reason: null };
}

export interface DriveEntry {
  id: string;
  name: string;
  mimeType: string;
  isFolder: boolean;
}

// The folders and images directly inside a folder (a Shared Drive's id is
// also its root folder's id). Folders first, then by name.
export async function listFolder(folderId: string): Promise<DriveEntry[]> {
  const out: DriveEntry[] = [];
  let pageToken: string | undefined;
  do {
    const page = await call<{
      files?: Array<{ id: string; name: string; mimeType: string }>;
      nextPageToken?: string;
    }>(
      `${API}/files?${qs({
        q: `${quote(folderId)} in parents and trashed = false and (mimeType = '${FOLDER_MIME}' or mimeType contains 'image/')`,
        fields: "nextPageToken,files(id,name,mimeType)",
        orderBy: "folder,name",
        pageSize: 1000,
        pageToken,
        corpora: "allDrives",
        includeItemsFromAllDrives: true,
        supportsAllDrives: true,
      })}`
    );
    for (const f of page.files ?? []) {
      out.push({ id: f.id, name: f.name, mimeType: f.mimeType, isFolder: f.mimeType === FOLDER_MIME });
    }
    pageToken = page.nextPageToken;
  } while (pageToken && out.length < 5000);
  return out;
}

async function fetchBytes(url: string): Promise<{ buffer: Buffer; contentType: string }> {
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${await accessToken()}` },
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) throw new Error(`Google Drive download failed (${res.status})`);
  return {
    buffer: Buffer.from(await res.arrayBuffer()),
    contentType: res.headers.get("content-type") || "application/octet-stream",
  };
}

export async function downloadFile(fileId: string): Promise<{ buffer: Buffer; name: string; mimeType: string }> {
  const meta = await call<{ name: string; mimeType: string }>(
    `${API}/files/${encodeURIComponent(fileId)}?${qs({ fields: "name,mimeType", supportsAllDrives: true })}`
  );
  if (!meta.mimeType.startsWith("image/")) throw new Error(`${meta.name} isn't an image`);
  const { buffer } = await fetchBytes(
    `${API}/files/${encodeURIComponent(fileId)}?${qs({ alt: "media", supportsAllDrives: true })}`
  );
  return { buffer, name: meta.name, mimeType: meta.mimeType };
}

// A small preview for the picker. Drive's thumbnailLink needs the same token,
// so the app proxies it rather than handing the browser a Drive URL.
export async function thumbnail(fileId: string, size = 400): Promise<{ buffer: Buffer; contentType: string }> {
  const meta = await call<{ thumbnailLink?: string; mimeType: string }>(
    `${API}/files/${encodeURIComponent(fileId)}?${qs({ fields: "thumbnailLink,mimeType", supportsAllDrives: true })}`
  );
  if (meta.thumbnailLink) {
    return fetchBytes(meta.thumbnailLink.replace(/=s\d+$/, `=s${size}`));
  }
  // No thumbnail yet (just uploaded): fall back to the file itself.
  return fetchBytes(`${API}/files/${encodeURIComponent(fileId)}?${qs({ alt: "media", supportsAllDrives: true })}`);
}

// ── Writing outputs ──

// Several images of one batch finish together; without this they'd each
// create their own "outputs/<model>/<date>" folder at the same moment.
const folderLocks = new Map<string, Promise<string>>();

async function findOrCreateFolder(parentId: string, name: string): Promise<string> {
  const key = `${parentId}/${name}`;
  const pending = folderLocks.get(key);
  if (pending) return pending;
  const work = (async () => {
    const found = await call<{ files?: Array<{ id: string }> }>(
      `${API}/files?${qs({
        q: `${quote(parentId)} in parents and name = ${quote(name)} and mimeType = '${FOLDER_MIME}' and trashed = false`,
        fields: "files(id)",
        pageSize: 1,
        corpora: "allDrives",
        includeItemsFromAllDrives: true,
        supportsAllDrives: true,
      })}`
    );
    if (found.files?.[0]) return found.files[0].id;
    const created = await call<{ id: string }>(`${API}/files?${qs({ supportsAllDrives: true, fields: "id" })}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, mimeType: FOLDER_MIME, parents: [parentId] }),
    });
    return created.id;
  })();
  folderLocks.set(key, work);
  try {
    return await work;
  } catch (err) {
    folderLocks.delete(key); // let the next attempt try again
    throw err;
  }
}

const MIME_BY_EXT: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".mp4": "video/mp4",
};

async function uploadFile(parentId: string, name: string, buffer: Buffer, mimeType: string) {
  const boundary = `oneup${crypto.randomBytes(8).toString("hex")}`;
  const body = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
        `${JSON.stringify({ name, parents: [parentId] })}\r\n` +
        `--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`
    ),
    buffer,
    Buffer.from(`\r\n--${boundary}--`),
  ]);
  return call<{ id: string; webViewLink?: string }>(
    `${UPLOAD_API}/files?${qs({ uploadType: "multipart", supportsAllDrives: true, fields: "id,webViewLink" })}`,
    {
      method: "POST",
      headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
      body,
      signal: AbortSignal.timeout(300_000),
    }
  );
}

// Folder names can't hold "/" on Drive's web UI without confusion.
const safeName = (s: string) => s.replace(/[\\/]+/g, "-").trim() || "Unnamed";

// File a generated output under <root>/outputs/<model>/<date>/.
export async function saveOutput(input: {
  rootId: string;
  model: string;
  date: string;
  filePath: string;
  fileName: string;
}): Promise<{ url: string | null; folder: string }> {
  let parent = await findOrCreateFolder(input.rootId, OUTPUTS_FOLDER);
  parent = await findOrCreateFolder(parent, safeName(input.model));
  parent = await findOrCreateFolder(parent, input.date);
  const ext = path.extname(input.filePath).toLowerCase();
  const file = await uploadFile(
    parent,
    input.fileName,
    fs.readFileSync(input.filePath),
    MIME_BY_EXT[ext] || "application/octet-stream"
  );
  return {
    url: file.webViewLink ?? null,
    folder: `${OUTPUTS_FOLDER}/${safeName(input.model)}/${input.date}`,
  };
}
