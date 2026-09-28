import { rawDb } from "../db";
import { can } from "@/lib/roles";
import type { PublicUser } from "./auth";
import { listTrends } from "./trends";
import { getTask, listTasks, ensureProductionTables, type ProductionTask } from "./production";
import { notifyUsers, usersWhere, type NotifyResult } from "./notify";

// The department's hand-offs, each one a button someone clicks and a message
// the next person gets:
//
//   1. researcher  "Finished for today"  → managers + CEO: trends to review
//   2. CEO         "Done reviewing"      → managers: approved, start working
//   3. manager     "Send tasks"          → each creator: their new tasks
//   4. creator     "Finished"            → managers: handed in, Drive links
//   5. manager     "Uploaded to Drive"   → marketing managers: ready to post

let ensured = false;
function ensureWorkflowTables(): void {
  if (ensured) return;
  ensureProductionTables();
  rawDb.exec(`
    CREATE TABLE IF NOT EXISTS trend_day_marks (
      date TEXT NOT NULL,
      user_id INTEGER NOT NULL REFERENCES users(id),
      kind TEXT NOT NULL,
      at TEXT NOT NULL,
      PRIMARY KEY (date, user_id, kind)
    );
  `);
  ensured = true;
}

export type DayMarkKind = "research_done" | "review_done";

export interface DayMark {
  date: string;
  userId: number;
  name: string;
  kind: DayMarkKind;
  at: string;
}

export function dayMarks(date: string): DayMark[] {
  ensureWorkflowTables();
  const rows = rawDb
    .prepare(
      `SELECT m.date, m.user_id, u.name, m.kind, m.at FROM trend_day_marks m
       LEFT JOIN users u ON u.id = m.user_id WHERE m.date = ? ORDER BY m.at`
    )
    .all(date) as Array<{ date: string; user_id: number; name: string | null; kind: DayMarkKind; at: string }>;
  return rows.map((r) => ({ date: r.date, userId: r.user_id, name: r.name ?? "?", kind: r.kind, at: r.at }));
}

function mark(date: string, userId: number, kind: DayMarkKind): void {
  rawDb
    .prepare(
      `INSERT INTO trend_day_marks (date, user_id, kind, at) VALUES (?, ?, ?, ?)
       ON CONFLICT(date, user_id, kind) DO UPDATE SET at = excluded.at`
    )
    .run(date, userId, kind, new Date().toISOString());
}

const managers = () => usersWhere((u) => can.manageProduction(u));
const ceos = () => usersWhere((u) => u.role === "ceo");
const marketing = () => usersWhere((u) => u.role === "marketing_manager");

const prettyDay = (d: string) =>
  new Date(`${d}T12:00:00`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// 1 · The researcher is done for the day.
export async function researchFinished(user: PublicUser, date: string, origin: string): Promise<NotifyResult> {
  ensureWorkflowTables();
  const mine = listTrends({ date, createdBy: user.id });
  if (mine.length === 0) throw new Error("Add at least one reel or carousel for this day first.");
  mark(date, user.id, "research_done");
  const reels = mine.filter((t) => t.kind === "reel").length;
  const carousels = mine.length - reels;
  return notifyUsers(
    "research_done",
    [...managers(), ...ceos()].filter((u) => u.id !== user.id),
    {
      title: `Trends ready for review · ${prettyDay(date)}`,
      lines: [
        `${user.name} finished today's research: ${plural(reels, "reel")} and ${plural(carousels, "carousel")}.`,
        "Approve the ones worth producing, then they can be assigned.",
      ],
      link: { label: "Review trends", url: `${origin}/trends` },
    }
  );
}

// 2 · The CEO is done reviewing (the owner reviewing their own doesn't need
// to tell themselves).
export async function reviewFinished(user: PublicUser, date: string, origin: string): Promise<NotifyResult> {
  ensureWorkflowTables();
  const day = listTrends({ date });
  if (day.length === 0) throw new Error("There's nothing to review for this day.");
  const approved = day.filter((t) => t.status === "approved" && t.reviewedBy === user.name).length;
  const rejected = day.filter((t) => t.status === "rejected" && t.reviewedBy === user.name).length;
  mark(date, user.id, "review_done");
  return notifyUsers(
    "review_done",
    managers().filter((u) => u.id !== user.id),
    {
      title: `Content approved by ${user.name} · ${prettyDay(date)}`,
      lines: [
        `${plural(approved, "trend")} approved${rejected ? `, ${rejected} rejected` : ""}.`,
        approved ? "You can start working on it: pick the methods and assign the creators." : "Nothing was approved this time.",
      ],
      link: { label: "Open Production", url: `${origin}/production` },
    }
  );
}

function describe(t: ProductionTask): string {
  const what = t.trend?.niche || (t.trend?.kind === "carousel" ? "Carousel" : "Reel");
  return `${what}: ${t.items.map((i) => i.model).join(", ")} (due ${prettyDay(t.dueDate)})`;
}

// 3 · The manager has assigned methods: tell each creator what's new.
export async function sendTasks(origin: string): Promise<{ creators: number; tasks: number; results: NotifyResult[] }> {
  ensureWorkflowTables();
  const unsent = listTasks({}).filter((t) => !t.sentAt);
  if (unsent.length === 0) throw new Error("Every task has already been sent.");
  const byCreator = new Map<number, ProductionTask[]>();
  for (const t of unsent) byCreator.set(t.assigneeId, [...(byCreator.get(t.assigneeId) ?? []), t]);

  const people = new Map(usersWhere(() => true).map((u) => [u.id, u]));
  const results: NotifyResult[] = [];
  const now = new Date().toISOString();
  for (const [creatorId, tasks] of byCreator) {
    const creator = people.get(creatorId);
    if (!creator) continue;
    const videos = tasks.reduce((n, t) => n + t.items.length, 0);
    results.push(
      await notifyUsers("tasks_sent", [creator], {
        title: `You have ${plural(tasks.length, "new task")} (${plural(videos, "video")})`,
        lines: [...tasks.map((t) => `• ${describe(t)}`), "The method and an example are in each task. Hand each one in as a Drive link."],
        link: { label: "Open my tasks", url: `${origin}/production` },
      })
    );
    const stmt = rawDb.prepare("UPDATE production_tasks SET sent_at = ? WHERE id = ?");
    for (const t of tasks) stmt.run(now, t.id);
  }
  return { creators: byCreator.size, tasks: unsent.length, results };
}

// 4 · The creator has handed everything in.
export async function taskFinished(user: PublicUser, taskId: number, origin: string): Promise<NotifyResult> {
  ensureWorkflowTables();
  const t = getTask(taskId);
  if (!t) throw new Error("Task not found");
  if (t.assigneeId !== user.id) throw new Error("This isn't your task");
  const missing = t.items.filter((i) => i.status === "todo" || i.status === "rejected");
  if (missing.length) {
    throw new Error(`Hand in ${missing.map((i) => i.model).join(", ")} first.`);
  }
  rawDb.prepare("UPDATE production_tasks SET finished_at = ? WHERE id = ?").run(new Date().toISOString(), taskId);
  return notifyUsers("task_finished", managers().filter((u) => u.id !== user.id), {
    title: `${user.name} finished a task`,
    lines: [describe(t), ...t.items.map((i) => `${i.model}: ${i.driveUrl}`)],
    link: { label: "Review in OneUp", url: `${origin}/production` },
  });
}

// 5 · The manager has put the finished videos in the shared Drive.
export async function taskUploaded(user: PublicUser, taskId: number, url: string): Promise<NotifyResult> {
  ensureWorkflowTables();
  const t = getTask(taskId);
  if (!t) throw new Error("Task not found");
  try {
    new URL(url);
  } catch {
    throw new Error("Paste the Drive folder link");
  }
  rawDb
    .prepare("UPDATE production_tasks SET uploaded_at = ?, upload_url = ? WHERE id = ?")
    .run(new Date().toISOString(), url.trim(), taskId);
  return notifyUsers("task_uploaded", marketing().filter((u) => u.id !== user.id), {
    title: "New content uploaded to Drive",
    lines: [
      `${describe(t)}.`,
      `${plural(t.items.length, "video")} ready to post, uploaded by ${user.name}.`,
    ],
    link: { label: "Open the Drive folder", url: url.trim() },
  });
}
