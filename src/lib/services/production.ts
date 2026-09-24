import { rawDb } from "../db";
import { ensureTrendTables, getTrend, type ReviewStatus, type Trend } from "./trends";
import { listSavedGenerations as listHiggsfieldSaved } from "./higgsfield";
import { listSavedGenerations as listYapperSaved } from "./yapper";

// Production board: the manager turns an approved trend into a task for one
// content creator — which method to use (a saved Higgsfield/Yapper
// generation from /methods), which models to make it for, and one finished
// example for one of those models. The creator then makes the rest: one task
// item per remaining model, each handed in as a Drive link and approved or
// rejected on its own.

export type MethodService = "higgsfield" | "yapper";
export type ItemStatus = "todo" | "submitted" | "approved" | "rejected";

let ensured = false;
export function ensureProductionTables(): void {
  if (ensured) return;
  ensureTrendTables();
  rawDb.exec(`
    CREATE TABLE IF NOT EXISTS production_tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      trend_id INTEGER NOT NULL REFERENCES trend_suggestions(id),
      method_service TEXT,
      method_id TEXT,
      assignee_id INTEGER NOT NULL REFERENCES users(id),
      example_model TEXT,
      example_url TEXT,
      notes TEXT,
      due_date TEXT NOT NULL,
      created_by INTEGER NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS production_tasks_assignee ON production_tasks (assignee_id, due_date);
    CREATE INDEX IF NOT EXISTS production_tasks_trend ON production_tasks (trend_id);
    CREATE TABLE IF NOT EXISTS task_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id INTEGER NOT NULL REFERENCES production_tasks(id),
      model TEXT NOT NULL,
      drive_url TEXT,
      status TEXT NOT NULL DEFAULT 'todo',
      submitted_at TEXT,
      review_note TEXT,
      reviewed_by INTEGER REFERENCES users(id),
      reviewed_at TEXT
    );
    CREATE INDEX IF NOT EXISTS task_items_task ON task_items (task_id);
  `);
  ensured = true;
}

export interface MethodRef {
  service: MethodService;
  id: string;
  type: string;
  model: string;
  prompt: string;
  outputPath: string | null;
  thumbnailPath: string | null;
  // The reference photos/videos the generation was made from (Higgsfield
  // echoes them back; Yapper's history doesn't, so it's empty there).
  medias: Array<{ role: string; url: string; type?: string }>;
}

// Every saved generation across both services, in one shape — the picker the
// manager chooses a method from.
export function listMethods(): MethodRef[] {
  const out: MethodRef[] = [];
  try {
    for (const g of listHiggsfieldSaved()) {
      out.push({
        service: "higgsfield",
        id: g.higgsfieldId,
        type: g.type,
        model: g.model,
        prompt: g.prompt,
        outputPath: g.outputPath,
        thumbnailPath: g.thumbnailPath,
        medias: g.medias ?? [],
      });
    }
  } catch {
    // table not created yet — nothing saved
  }
  try {
    for (const g of listYapperSaved()) {
      out.push({
        service: "yapper",
        id: g.yapperId,
        type: g.type,
        model: g.model,
        prompt: g.prompt,
        outputPath: g.outputPath,
        thumbnailPath: g.thumbnailPath,
        medias: g.medias ?? [],
      });
    }
  } catch {
    // same
  }
  return out;
}

export interface TaskItem {
  id: number;
  taskId: number;
  model: string;
  driveUrl: string | null;
  status: ItemStatus;
  submittedAt: string | null;
  reviewNote: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
}

export interface ProductionTask {
  id: number;
  trend: Trend | null;
  method: MethodRef | null;
  assigneeId: number;
  assignee: string;
  exampleModel: string | null;
  exampleUrl: string | null;
  notes: string | null;
  dueDate: string;
  createdBy: string;
  createdAt: string;
  items: TaskItem[];
}

interface TaskRow {
  id: number;
  trend_id: number;
  method_service: MethodService | null;
  method_id: string | null;
  assignee_id: number;
  assignee_name: string | null;
  example_model: string | null;
  example_url: string | null;
  notes: string | null;
  due_date: string;
  creator_name: string | null;
  created_at: string;
}

interface ItemRow {
  id: number;
  task_id: number;
  model: string;
  drive_url: string | null;
  status: ItemStatus;
  submitted_at: string | null;
  review_note: string | null;
  reviewer_name: string | null;
  reviewed_at: string | null;
}

const toItem = (r: ItemRow): TaskItem => ({
  id: r.id,
  taskId: r.task_id,
  model: r.model,
  driveUrl: r.drive_url,
  status: r.status,
  submittedAt: r.submitted_at,
  reviewNote: r.review_note,
  reviewedBy: r.reviewer_name,
  reviewedAt: r.reviewed_at,
});

export function listTasks(filter: {
  assigneeId?: number;
  dueDate?: string;
  trendId?: number;
  openOnly?: boolean;
}): ProductionTask[] {
  ensureProductionTables();
  const where: string[] = [];
  const args: unknown[] = [];
  const add = (clause: string, value: unknown) => {
    where.push(clause);
    args.push(value);
  };
  if (filter.assigneeId) add("p.assignee_id = ?", filter.assigneeId);
  if (filter.dueDate) add("p.due_date = ?", filter.dueDate);
  if (filter.trendId) add("p.trend_id = ?", filter.trendId);
  if (filter.openOnly) {
    where.push(
      "EXISTS (SELECT 1 FROM task_items i WHERE i.task_id = p.id AND i.status != 'approved')"
    );
  }
  const rows = rawDb
    .prepare(
      `SELECT p.*, a.name AS assignee_name, c.name AS creator_name
       FROM production_tasks p
       LEFT JOIN users a ON a.id = p.assignee_id
       LEFT JOIN users c ON c.id = p.created_by
       ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
       ORDER BY p.due_date DESC, p.id DESC`
    )
    .all(...args) as TaskRow[];
  if (rows.length === 0) return [];

  const ids = rows.map((r) => r.id);
  const items = rawDb
    .prepare(
      `SELECT i.*, r.name AS reviewer_name FROM task_items i
       LEFT JOIN users r ON r.id = i.reviewed_by
       WHERE i.task_id IN (${ids.map(() => "?").join(",")})
       ORDER BY i.id`
    )
    .all(...ids) as ItemRow[];

  const methods = new Map(listMethods().map((m) => [`${m.service}:${m.id}`, m]));
  const trends = new Map<number, Trend | null>();

  return rows.map((r) => {
    if (!trends.has(r.trend_id)) trends.set(r.trend_id, getTrend(r.trend_id));
    return {
      id: r.id,
      trend: trends.get(r.trend_id) ?? null,
      method:
        r.method_service && r.method_id
          ? methods.get(`${r.method_service}:${r.method_id}`) ?? null
          : null,
      assigneeId: r.assignee_id,
      assignee: r.assignee_name || "(deleted user)",
      exampleModel: r.example_model,
      exampleUrl: r.example_url,
      notes: r.notes,
      dueDate: r.due_date,
      createdBy: r.creator_name || "(deleted user)",
      createdAt: r.created_at,
      items: items.filter((i) => i.task_id === r.id).map(toItem),
    };
  });
}

export function getTask(id: number): ProductionTask | null {
  ensureProductionTables();
  const row = rawDb.prepare("SELECT assignee_id FROM production_tasks WHERE id = ?").get(id) as
    | { assignee_id: number }
    | undefined;
  if (!row) return null;
  return listTasks({ assigneeId: row.assignee_id }).find((t) => t.id === id) ?? null;
}

export interface TaskInput {
  trendId: number;
  methodService?: MethodService | null;
  methodId?: string | null;
  assigneeId: number;
  models: string[];
  exampleModel?: string | null;
  exampleUrl?: string | null;
  notes?: string | null;
  dueDate: string;
}

export function createTask(input: TaskInput, createdBy: number): ProductionTask {
  ensureProductionTables();
  const trend = getTrend(input.trendId);
  if (!trend) throw new Error("That trend no longer exists");
  if (trend.status !== "approved") throw new Error("Only approved trends can be assigned");

  const models = [...new Set(input.models.map((m) => m.trim()).filter(Boolean))];
  const example = input.exampleModel?.trim() || null;
  // The example model is already done (by the manager) — the creator only
  // gets items for the rest.
  const todo = models.filter((m) => m !== example);
  if (todo.length === 0) throw new Error("Pick at least one model besides the example");

  const tx = rawDb.transaction(() => {
    const info = rawDb
      .prepare(
        `INSERT INTO production_tasks
          (trend_id, method_service, method_id, assignee_id, example_model, example_url, notes, due_date, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        input.trendId,
        input.methodService || null,
        input.methodId || null,
        input.assigneeId,
        example,
        input.exampleUrl?.trim() || null,
        input.notes?.trim() || null,
        input.dueDate,
        createdBy,
        new Date().toISOString()
      );
    const taskId = Number(info.lastInsertRowid);
    const insertItem = rawDb.prepare("INSERT INTO task_items (task_id, model) VALUES (?, ?)");
    for (const m of todo) insertItem.run(taskId, m);
    return taskId;
  });
  return getTask(tx())!;
}

export function deleteTask(id: number): void {
  ensureProductionTables();
  rawDb.transaction(() => {
    rawDb.prepare("DELETE FROM task_items WHERE task_id = ?").run(id);
    rawDb.prepare("DELETE FROM production_tasks WHERE id = ?").run(id);
  })();
}

export function taskCountForTrend(trendId: number): number {
  ensureProductionTables();
  const row = rawDb
    .prepare("SELECT COUNT(*) AS n FROM production_tasks WHERE trend_id = ?")
    .get(trendId) as { n: number };
  return row.n;
}

function itemWithTask(itemId: number): { item: ItemRow; assigneeId: number } | null {
  ensureProductionTables();
  const row = rawDb
    .prepare(
      `SELECT i.*, NULL AS reviewer_name, p.assignee_id FROM task_items i
       JOIN production_tasks p ON p.id = i.task_id WHERE i.id = ?`
    )
    .get(itemId) as (ItemRow & { assignee_id: number }) | undefined;
  return row ? { item: row, assigneeId: row.assignee_id } : null;
}

export function itemAssignee(itemId: number): number | null {
  return itemWithTask(itemId)?.assigneeId ?? null;
}

export function submitItem(itemId: number, driveUrl: string): void {
  const found = itemWithTask(itemId);
  if (!found) throw new Error("Task item not found");
  if (found.item.status === "approved") throw new Error("Already approved");
  rawDb
    .prepare(
      `UPDATE task_items SET drive_url = ?, status = 'submitted', submitted_at = ?,
         review_note = NULL, reviewed_by = NULL, reviewed_at = NULL WHERE id = ?`
    )
    .run(driveUrl.trim(), new Date().toISOString(), itemId);
}

export function reviewItem(
  itemId: number,
  status: Extract<ReviewStatus, "approved" | "rejected">,
  note: string | null,
  reviewerId: number
): void {
  const found = itemWithTask(itemId);
  if (!found) throw new Error("Task item not found");
  if (!found.item.drive_url) throw new Error("Nothing handed in yet");
  rawDb
    .prepare(
      "UPDATE task_items SET status = ?, review_note = ?, reviewed_by = ?, reviewed_at = ? WHERE id = ?"
    )
    .run(status, note?.trim() || null, reviewerId, new Date().toISOString(), itemId);
}

// Counts for the team page: items this user handed in / had approved or
// rejected inside [from, to).
export function itemStatsForUser(
  userId: number,
  from: string,
  to: string
): { submitted: number; approved: number; rejected: number; open: number } {
  ensureProductionTables();
  const row = rawDb
    .prepare(
      `SELECT
         SUM(i.submitted_at >= ? AND i.submitted_at < ?) AS submitted,
         SUM(i.status = 'approved' AND i.reviewed_at >= ? AND i.reviewed_at < ?) AS approved,
         SUM(i.status = 'rejected' AND i.reviewed_at >= ? AND i.reviewed_at < ?) AS rejected,
         SUM(i.status IN ('todo', 'rejected')) AS open
       FROM task_items i JOIN production_tasks p ON p.id = i.task_id
       WHERE p.assignee_id = ?`
    )
    .get(from, to, from, to, from, to, userId) as Record<string, number | null>;
  return {
    submitted: row.submitted ?? 0,
    approved: row.approved ?? 0,
    rejected: row.rejected ?? 0,
    open: row.open ?? 0,
  };
}
