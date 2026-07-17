// Single-command launcher: runs the Next.js UI and the job worker together,
// and auto-restarts the worker if it ever exits. Use: `npm run start:all`.
//
// Why: the app needs BOTH processes. The UI only writes jobs as `queued`; the
// worker is what submits them to Higgsfield/RunningHub. If the worker isn't
// running, generation silently stops ("queued forever"). This keeps it alive.

import { spawn } from "node:child_process";

const isWin = process.platform === "win32";
let shuttingDown = false;
const children = [];

function run(name, color, cmd, args, { restart = false } = {}) {
  const child = spawn(cmd, args, {
    shell: isWin, // npm/tsx resolve via shell on Windows
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
    }
  });
  return child;
}

// UI (not auto-restarted — if Next dev dies you'll want to see why)
run("ui", "36", "npm", ["run", "dev:ui"]);
// Worker (auto-restarted — must always be up for generation to work)
run("worker", "35", "npm", ["run", "worker"], { restart: true });

function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  process.stdout.write("\n[start:all] shutting down...\n");
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
