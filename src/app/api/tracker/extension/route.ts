import { NextResponse } from "next/server";
import archiver from "archiver";
import fs from "fs";
import path from "path";
import { PassThrough } from "stream";
import { requireUser } from "@/lib/services/auth";

// The Chrome extension in extension/, zipped, so a teammate can install it
// from the Tracker page without a copy of the repo.
export async function GET() {
  const { deny } = await requireUser();
  if (deny) return deny;

  const dir = path.resolve("./extension");
  if (!fs.existsSync(dir)) {
    return NextResponse.json({ error: "extension/ folder missing from this deploy" }, { status: 404 });
  }

  const archive = archiver("zip", { zlib: { level: 6 } });
  const passthrough = new PassThrough();
  archive.pipe(passthrough);
  archive.directory(dir, "mecha-work-tracker");
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
      "Content-Disposition": 'attachment; filename="mecha-work-tracker.zip"',
    },
  });
}
