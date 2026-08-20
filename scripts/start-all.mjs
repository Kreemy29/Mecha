// Production launcher: points the app's data directories at the mounted disk,
// then runs the Next server and the job worker together.
//
// Why both here: the UI only ever writes jobs as `queued`; the worker is what
// submits them to Higgsfield/RunningHub/KIE. Without it, generation silently
// stops. Render restarts the whole service if this process exits, and the
// worker is restarted in-process if it dies on its own.

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

// Render mounts the persistent disk here. Everything that must survive a
// deploy lives on it: the SQLite database, the Higgsfield OAuth token, and all
// uploaded/generated media.
const DISK = process.env.DATA_DIR || "/data";

// The app resolves "./data" and "./storage" relative to the working directory
// and several paths are hardcoded (e.g. data/higgsfield-token.json), so rather
// than making every path configurable, point those two names at the disk.
function linkToDisk(name) {
  const target = path.join(DISK, name);
  const link = path.resolve(name);
  try {
    fs.mkdirSync(target, { recursive: true });
  } catch (err) {
    console.error(`[start] cannot create ${target}:`, err.message);
    return;
  }
  try {
    const existing = fs.lstatSync(link);
    // A real directory here means the image shipped one; leave it alone rather
    // than deleting data we did not create.
    if (existing.isSymbolicLink()) fs.unlinkSync(link);
    else if (existing.isDirectory() && fs.readdirSync(link).length === 0) {
      fs.rmdirSync(link);
    } else {
      console.log(`[start] ${name}/ exists and is not empty — leaving as-is`);
      return;
    }
  } catch {
    // nothing there yet, which is the normal case
  }
  fs.symlinkSync(target, link, "junction");
  console.log(`[start] ${name}/ -> ${target}`);
}

if (fs.existsSync(DISK)) {
  linkToDisk("data");
  linkToDisk("storage");
} else {
  console.log(`[start] no disk at ${DISK} — using local ./data and ./storage`);
}

let shuttingDown = false;
const children = [];

function run(name, color, cmd, args, { restart = false } = {}) {
  const child = spawn(cmd, args, {
    shell: process.platform === "win32",
    stdio: ["ignore", "pipe", "pipe"],
    env: process.env,
  });
  children.push(child);

  const prefix = `\x1b[${color}m[${name}]\x1b[0m `;
  const pipe = (stream, dest) => {
    let buf = "";
    stream.on("data", (chunk) => {
      buf += chunk.toString();
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) dest.write(prefix + line + "\n");
    });
  };
  pipe(child.stdout, process.stdout);
  pipe(child.stderr, process.stderr);

  child.on("exit", (code) => {
    if (shuttingDown) return;
    process.stdout.write(prefix + `exited (code ${code})\n`);
    if (restart) {
      process.stdout.write(prefix + "restarting in 2s...\n");
      setTimeout(() => run(name, color, cmd, args, { restart }), 2000);
      return;
    }
    // The web server dying is fatal — let the platform restart the service
    // rather than sitting here with a healthy process and no site.
    process.exit(code ?? 1);
  });
  return child;
}

const port = process.env.PORT || "3000";
run("web", "36", "npx", ["next", "start", "-p", port]);
run("worker", "35", "npx", ["tsx", "src/lib/worker/worker.ts"], { restart: true });

function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const c of children) {
    try {
      c.kill();
    } catch {
      // already gone
    }
  }
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
