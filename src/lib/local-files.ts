import fs from "fs";
import path from "path";

// Several server-side paths are handed an absolute URL that points back at
// this app's own /api/files route — the recreation prompt's scene reference,
// the background describer, the Higgsfield media uploader. Fetching those over
// HTTP was always a pointless round-trip (base64 of a file we already have on
// disk), and once login landed it became a bug: a server-to-server request
// carries no session cookie, so proxy.ts answers 401.
//
// Resolve them to a path on disk instead. Anything genuinely remote (a
// CloudFront character image, say) returns null and is fetched normally.

const FILES_PREFIX = "/api/files/";

export function localPathForUrl(src: string): string | null {
  let pathname: string;
  try {
    pathname = new URL(src).pathname;
  } catch {
    // Not an absolute URL — a data: URI or a bare relative path. Callers deal
    // with those themselves.
    return null;
  }
  if (!pathname.startsWith(FILES_PREFIX)) return null;

  const relative = decodeURIComponent(pathname.slice(FILES_PREFIX.length));
  const absolute = path.resolve(process.cwd(), relative);

  // Same guard the route itself applies: never serve outside storage/, so a
  // crafted ../ can't turn this into an arbitrary file read.
  const root = path.resolve(process.cwd(), "storage");
  if (absolute !== root && !absolute.startsWith(root + path.sep)) return null;

  return fs.existsSync(absolute) ? absolute : null;
}

// Bytes for a scene/face/background reference, wherever it lives.
export async function readMediaBytes(src: string): Promise<Buffer> {
  const local = localPathForUrl(src);
  if (local) return fs.readFileSync(local);

  const res = await fetch(src);
  if (!res.ok) {
    throw new Error(`Failed to fetch image (${res.status}): ${src}`);
  }
  return Buffer.from(await res.arrayBuffer());
}
