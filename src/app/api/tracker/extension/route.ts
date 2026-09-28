import { NextRequest, NextResponse } from "next/server";
import archiver from "archiver";
import fs from "fs";
import path from "path";
import { PassThrough } from "stream";
import { requireUser } from "@/lib/services/auth";

// The trackers, zipped, so a teammate can install them from the Tracker page
// without a copy of the repo.
//   (default)       → the Chrome extension in extension/
//   ?kind=desktop   → the Windows desktop tracker in desktop-tracker/
const PACKAGES = {
  chrome: { dir: "extension", name: "mecha-work-tracker" },
  desktop: { dir: "desktop-tracker", name: "OneUp Tracker" },
} as const;

export async function GET(request: NextRequest) {
  const { deny } = await requireUser();
  if (deny) return deny;

  const pkg = PACKAGES[request.nextUrl.searchParams.get("kind") === "desktop" ? "desktop" : "chrome"];
  const dir = path.resolve(pkg.dir);
  if (!fs.existsSync(dir)) {
    return NextResponse.json({ error: `${pkg.dir}/ folder missing from this deploy` }, { status: 404 });
  }

  const archive = archiver("zip", { zlib: { level: 6 } });
  const passthrough = new PassThrough();
  archive.pipe(passthrough);
  archive.directory(dir, pkg.name);
  archive.finalize();

  const stream = new ReadableStream({
    start(controller) {
      passthrough.on("data", (chunk) => controller.enqueue(chunk));
      passthrough.on("end", () => controller.close());
      passthrough.on("error", (err) => controller.error(err));
    },
  });

  return new NextResponse(stream as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${pkg.name.replace(/\s+/g, "-")}.zip"`,
    },
  });
}
