import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { inArray } from "drizzle-orm";
import archiver from "archiver";
import fs from "fs";
import path from "path";
import { PassThrough } from "stream";

// POST { jobIds: number[] } → streams a .zip of all succeeded job outputs.
export async function POST(request: NextRequest) {
  const { jobIds } = await request.json();

  if (!Array.isArray(jobIds) || jobIds.length === 0) {
    return NextResponse.json({ error: "jobIds[] required" }, { status: 400 });
  }

  const jobs = db
    .select()
    .from(schema.jobs)
    .where(inArray(schema.jobs.id, jobIds))
    .all();

  const downloadable = jobs.filter(
    (j) => j.status === "succeeded" && j.outputPath
  );

  if (downloadable.length === 0) {
    return NextResponse.json(
      { error: "No completed media to download" },
      { status: 404 }
    );
  }

  const archive = archiver("zip", { zlib: { level: 6 } });
  const passthrough = new PassThrough();
  archive.pipe(passthrough);

  for (const job of downloadable) {
    const abs = path.resolve(job.outputPath!);
    if (fs.existsSync(abs)) {
      const ext = path.extname(abs) || ".png";
      archive.file(abs, { name: `job_${job.id}${ext}` });
    }
  }

  archive.finalize();

  // Bridge Node stream → web ReadableStream
  const stream = new ReadableStream({
    start(controller) {
      passthrough.on("data", (chunk) => controller.enqueue(chunk));
      passthrough.on("end", () => controller.close());
      passthrough.on("error", (err) => controller.error(err));
    },
  });

  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  return new NextResponse(stream as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="mecha-ai-${stamp}.zip"`,
    },
  });
}
