"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  CheckCircle2,
  ClipboardList,
  Copy,
  ExternalLink,
  Loader2,
  Send,
  ThumbsDown,
  ThumbsUp,
  Trash2,
  Wand2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { can, ROLE_LABEL, type Role } from "@/lib/roles";
import { addDays, prettyDate, todayLocal } from "@/lib/day";
import { useMe } from "@/components/layout/me-context";
import {
  ChipPicker,
  PageHeader,
  StatusBadge,
  WorkBanners,
  shortLink,
} from "@/components/department/shared";

interface Trend {
  id: number;
  date: string;
  kind: "reel" | "carousel";
  url: string;
  niche: string | null;
  models: string[];
  justification: string;
  createdBy: string;
}

interface Method {
  service: "higgsfield" | "yapper";
  id: string;
  type: string;
  model: string;
  prompt: string;
  outputPath: string | null;
  thumbnailPath: string | null;
}

interface Item {
  id: number;
  model: string;
  driveUrl: string | null;
  status: "todo" | "submitted" | "approved" | "rejected";
  submittedAt: string | null;
  reviewNote: string | null;
  reviewedBy: string | null;
}

interface Task {
  id: number;
  trend: Trend | null;
  method: Method | null;
  assigneeId: number;
  assignee: string;
  exampleModel: string | null;
  exampleUrl: string | null;
  notes: string | null;
  dueDate: string;
  createdBy: string;
  items: Item[];
}

interface Person {
  id: number;
  name: string;
  role: Role;
}

const fileUrl = (p: string) => `/api/files/${p.replace(/\\/g, "/")}`;
const isDone = (t: Task) => t.items.every((i) => i.status === "approved");

async function api(method: string, body?: unknown, query = "") {
  const res = await fetch(`/api/production${query}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return data;
}

export default function ProductionPage() {
  const { me } = useMe();
  const manager = !!me && can.manageProduction(me);
  const seesAll = !!me && can.viewAllProduction(me);

  const [tasks, setTasks] = useState<Task[]>([]);
  const [approved, setApproved] = useState<Trend[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [loading, setLoading] = useState(true);
  const [showDone, setShowDone] = useState(false);
  const [assignee, setAssignee] = useState<number | "all">("all");
  const [assigning, setAssigning] = useState<Trend | null>(null);

  const load = useCallback(async () => {
    if (!me) return;
    const [t, a] = await Promise.all([
      fetch(`/api/production${seesAll ? "" : "?mine=1"}`).then((r) => r.json()),
      seesAll
        ? fetch(`/api/trends?status=approved&from=${addDays(todayLocal(), -30)}`).then((r) => r.json())
        : Promise.resolve([]),
    ]);
    setTasks(Array.isArray(t) ? t : []);
    setApproved(Array.isArray(a) ? a : []);
    setLoading(false);
  }, [me, seesAll]);

  useEffect(() => {
    (async () => {
      await load();
    })();
  }, [load]);

  useEffect(() => {
    if (!manager) return;
    fetch("/api/team?people=1")
      .then((r) => r.json())
      .then((d) => setPeople(Array.isArray(d) ? d : []))
      .catch(() => {});
  }, [manager]);

  const assignedTrendIds = useMemo(() => new Set(tasks.map((t) => t.trend?.id)), [tasks]);
  const waiting = approved.filter((t) => !assignedTrendIds.has(t.id));

  const visible = tasks
    .filter((t) => (showDone ? isDone(t) : !isDone(t)))
    .filter((t) => assignee === "all" || t.assigneeId === assignee)
    .sort((a, b) => (showDone ? b.dueDate.localeCompare(a.dueDate) : a.dueDate.localeCompare(b.dueDate)));

  const assignees = useMemo(() => {
    const m = new Map<number, string>();
    for (const t of tasks) m.set(t.assigneeId, t.assignee);
    return [...m.entries()];
  }, [tasks]);

  const act = async (itemId: number, action: "submit" | "approve" | "reject", extra: Record<string, unknown> = {}) => {
    try {
      await api("PATCH", { itemId, action, ...extra });
      await load();
      toast.success(action === "submit" ? "Handed in" : action === "approve" ? "Approved" : "Sent back");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    }
  };

  const removeTask = async (t: Task) => {
    if (!confirm(`Delete the task for ${t.assignee}? Their hand-ins on it are removed too.`)) return;
    try {
      await api("DELETE", undefined, `?id=${t.id}`);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Delete failed");
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Production"
        subtitle={
          manager
            ? "Turn approved trends into tasks: pick the method, the creator and the models, show one example."
            : seesAll
              ? "Everything in production, and what's been handed in."
              : "Your assigned videos. Make one per model and hand each in as a Drive link."
        }
      />

      <WorkBanners />

      {seesAll && (
        <section className="space-y-3">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <Wand2 className="h-4 w-4 text-brand" />
            Approved trends waiting for a method
            <Badge className="bg-white/10 border-0 text-[10px]">{waiting.length}</Badge>
          </h3>
          {loading ? (
            <Skeleton className="h-20 rounded-xl" />
          ) : waiting.length === 0 ? (
            <div className="glass rounded-xl p-5 text-sm text-muted-foreground text-center">
              Nothing waiting. Approved trends from the last 30 days show up here.
            </div>
          ) : (
            <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-3">
              {waiting.map((t) => (
                <div key={t.id} className="glass rounded-xl p-3 space-y-2">
                  <div className="flex items-center gap-2">
                    <Badge className="bg-white/10 border-0 text-[10px] capitalize">{t.kind}</Badge>
                    <span className="text-[11px] text-muted-foreground">{prettyDate(t.date)}</span>
                    <span className="text-[11px] text-muted-foreground ml-auto">by {t.createdBy}</span>
                  </div>
                  <a
                    href={t.url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-sm font-medium hover:underline flex items-center gap-1.5 min-w-0"
                  >
                    <ExternalLink className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <span className="truncate">{shortLink(t.url)}</span>
                  </a>
                  <p className="text-xs text-muted-foreground line-clamp-2">{t.justification}</p>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {t.models.map((m) => (
                      <Badge key={m} className="bg-white/10 border-0 text-[10px]">
                        {m}
                      </Badge>
                    ))}
                    {manager && (
                      <Button
                        size="sm"
                        onClick={() => setAssigning(t)}
                        className="ml-auto h-7 px-2.5 text-xs rounded-lg bg-brand hover:bg-brand/90 text-brand-foreground"
                      >
                        Assign
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      <section className="space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <ClipboardList className="h-4 w-4 text-brand" />
            {seesAll ? "Tasks" : "My tasks"}
          </h3>
          <div className="glass rounded-lg p-0.5 flex text-xs ml-2">
            {[false, true].map((done) => (
              <button
                key={String(done)}
                onClick={() => setShowDone(done)}
                className={cn(
                  "px-2.5 py-1 rounded-md",
                  showDone === done ? "bg-white/10 text-foreground" : "text-muted-foreground"
                )}
              >
                {done ? "Done" : "In progress"}
              </button>
            ))}
          </div>
          {seesAll && assignees.length > 1 && (
            <select
              value={assignee}
              onChange={(e) => setAssignee(e.target.value === "all" ? "all" : Number(e.target.value))}
              className="glass border border-white/10 rounded-lg h-7 px-2 text-xs bg-transparent"
            >
              <option value="all" className="bg-card">Everyone</option>
              {assignees.map(([id, name]) => (
                <option key={id} value={id} className="bg-card">
                  {name}
                </option>
              ))}
            </select>
          )}
        </div>

        {loading ? (
          <Skeleton className="h-40 rounded-xl" />
        ) : visible.length === 0 ? (
          <div className="glass rounded-xl p-6 text-center text-sm text-muted-foreground">
            {showDone ? "Nothing fully approved yet." : "No tasks in progress."}
          </div>
        ) : (
          visible.map((t) => (
            <TaskCard
              key={t.id}
              task={t}
              manager={manager}
              mine={t.assigneeId === me?.id}
              onAct={act}
              onDelete={() => removeTask(t)}
            />
          ))
        )}
      </section>

      {assigning && (
        <AssignDialog
          trend={assigning}
          people={people}
          onClose={() => setAssigning(null)}
          onCreated={async () => {
            setAssigning(null);
            await load();
          }}
        />
      )}
    </div>
  );
}

function MethodPreview({ method }: { method: Method }) {
  const src = method.outputPath ? fileUrl(method.outputPath) : null;
  return (
    <div className="flex gap-3">
      <div className="h-28 w-20 shrink-0 rounded-lg overflow-hidden bg-black/40">
        {src &&
          (method.type === "video" ? (
            <video src={src} controls muted playsInline className="h-full w-full object-cover" />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={src} alt="" className="h-full w-full object-cover" />
          ))}
      </div>
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex items-center gap-1.5">
          <Badge className="bg-white/10 border-0 text-[10px] capitalize">{method.service}</Badge>
          <span className="text-xs font-medium truncate">{method.model}</span>
          <button
            onClick={() => {
              navigator.clipboard.writeText(method.prompt);
              toast.success("Prompt copied");
            }}
            className="ml-auto text-[11px] text-muted-foreground hover:text-foreground flex items-center gap-1"
          >
            <Copy className="h-3 w-3" /> Copy prompt
          </button>
        </div>
        <p className="text-[11px] text-muted-foreground line-clamp-4 whitespace-pre-wrap">
          {method.prompt || "(no prompt)"}
        </p>
      </div>
    </div>
  );
}

function TaskCard({
  task: t,
  manager,
  mine,
  onAct,
  onDelete,
}: {
  task: Task;
  manager: boolean;
  mine: boolean;
  onAct: (itemId: number, action: "submit" | "approve" | "reject", extra?: Record<string, unknown>) => Promise<void>;
  onDelete: () => void;
}) {
  const done = t.items.filter((i) => i.status === "approved").length;
  const overdue = !isDone(t) && t.dueDate < todayLocal();

  return (
    <div className="glass rounded-2xl p-4 space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        {t.trend && (
          <>
            <Badge className="bg-white/10 border-0 text-[10px] capitalize">{t.trend.kind}</Badge>
            <a
              href={t.trend.url}
              target="_blank"
              rel="noreferrer"
              className="text-sm font-medium hover:underline flex items-center gap-1.5 min-w-0"
            >
              <ExternalLink className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <span className="truncate max-w-[28ch]">{shortLink(t.trend.url)}</span>
            </a>
          </>
        )}
        <span className={cn("text-[11px]", overdue ? "text-red-300" : "text-muted-foreground")}>
          due {prettyDate(t.dueDate)}
          {overdue && " · overdue"}
        </span>
        <span className="text-[11px] text-muted-foreground ml-auto">
          {manager || !mine ? `${t.assignee} · ` : ""}
          {done}/{t.items.length} approved
        </span>
        {manager && (
          <Button size="sm" variant="ghost" onClick={onDelete} className="h-7 w-7 p-0 hover:text-red-300" title="Delete task">
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <div className="space-y-3">
          {t.method ? (
            <MethodPreview method={t.method} />
          ) : (
            <p className="text-xs text-muted-foreground">No method attached.</p>
          )}
          {(t.exampleModel || t.exampleUrl) && (
            <div className="rounded-lg bg-brand/10 px-3 py-2 text-xs space-y-0.5">
              <p className="font-medium">Example{t.exampleModel && ` for ${t.exampleModel}`}</p>
              {t.exampleUrl && (
                <a href={t.exampleUrl} target="_blank" rel="noreferrer" className="underline underline-offset-2 break-all">
                  {shortLink(t.exampleUrl)}
                </a>
              )}
            </div>
          )}
          {t.notes && <p className="text-xs text-foreground/80 whitespace-pre-wrap">{t.notes}</p>}
        </div>

        <div className="space-y-2">
          {t.items.map((i) => (
            <ItemRow key={i.id} item={i} manager={manager} mine={mine} onAct={onAct} />
          ))}
        </div>
      </div>
    </div>
  );
}

function ItemRow({
  item: i,
  manager,
  mine,
  onAct,
}: {
  item: Item;
  manager: boolean;
  mine: boolean;
  onAct: (itemId: number, action: "submit" | "approve" | "reject", extra?: Record<string, unknown>) => Promise<void>;
}) {
  const [link, setLink] = useState(i.driveUrl || "");
  const [busy, setBusy] = useState(false);
  const canSubmit = mine && i.status !== "approved";

  const run = async (action: "submit" | "approve" | "reject", extra?: Record<string, unknown>) => {
    setBusy(true);
    try {
      await onAct(i.id, action, extra);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-xl border border-white/5 bg-white/[0.02] p-2.5 space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium">{i.model}</span>
        <StatusBadge status={i.status} />
        {i.driveUrl && (
          <a
            href={i.driveUrl}
            target="_blank"
            rel="noreferrer"
            className="text-[11px] text-muted-foreground hover:text-foreground underline underline-offset-2 ml-auto flex items-center gap-1"
          >
            <ExternalLink className="h-3 w-3" /> Open
          </a>
        )}
      </div>
      {i.reviewNote && (
        <p className="text-xs rounded-lg bg-red-500/10 text-red-200 px-2.5 py-1.5">
          <span className="font-medium">{i.reviewedBy}:</span> {i.reviewNote}
        </p>
      )}
      {canSubmit && (
        <div className="flex gap-1.5">
          <Input
            value={link}
            onChange={(e) => setLink(e.target.value)}
            placeholder="Google Drive link"
            className="glass border-white/10 h-8 text-xs"
          />
          <Button
            size="sm"
            disabled={busy || !link.trim() || (link.trim() === i.driveUrl && i.status === "submitted")}
            onClick={() => run("submit", { driveUrl: link })}
            className="h-8 px-2.5 text-xs rounded-lg bg-brand hover:bg-brand/90 text-brand-foreground gap-1"
          >
            {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
            {i.status === "submitted" ? "Update" : "Hand in"}
          </Button>
        </div>
      )}
      {manager && i.status === "submitted" && (
        <div className="flex gap-1.5 justify-end">
          <Button
            size="sm"
            disabled={busy}
            onClick={() => run("approve")}
            className="h-7 px-2 text-xs rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-200 gap-1"
          >
            <ThumbsUp className="h-3 w-3" /> Approve
          </Button>
          <Button
            size="sm"
            disabled={busy}
            onClick={() => {
              const note = window.prompt(`What needs fixing on ${i.model}?`);
              if (note !== null) run("reject", { note });
            }}
            className="h-7 px-2 text-xs rounded-lg bg-red-500/15 hover:bg-red-500/25 text-red-200 gap-1"
          >
            <ThumbsDown className="h-3 w-3" /> Reject
          </Button>
        </div>
      )}
      {i.status === "approved" && (
        <p className="text-[11px] text-emerald-300/80 flex items-center gap-1">
          <CheckCircle2 className="h-3 w-3" /> approved by {i.reviewedBy}
        </p>
      )}
    </div>
  );
}

function AssignDialog({
  trend,
  people,
  onClose,
  onCreated,
}: {
  trend: Trend;
  people: Person[];
  onClose: () => void;
  onCreated: () => Promise<void>;
}) {
  const [methods, setMethods] = useState<Method[] | null>(null);
  const [methodType, setMethodType] = useState<"video" | "image">("video");
  const [method, setMethod] = useState<Method | null>(null);
  const [allModels, setAllModels] = useState<string[]>(trend.models);
  const [models, setModels] = useState<string[]>(trend.models);
  const [exampleModel, setExampleModel] = useState(trend.models[0] || "");
  const [exampleUrl, setExampleUrl] = useState("");
  const [assigneeId, setAssigneeId] = useState<number | "">("");
  const [dueDate, setDueDate] = useState(todayLocal());
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  const creators = people.filter((p) => p.role === "content_creator" || p.role === "ai_artist");
  const others = people.filter((p) => !creators.includes(p));

  useEffect(() => {
    api("GET", undefined, "?methods=1")
      .then(setMethods)
      .catch(() => setMethods([]));
    fetch("/api/instagram/taxonomy")
      .then((r) => r.json())
      .then((d) => setAllModels([...new Set([...trend.models, ...(d.models || [])])]))
      .catch(() => {});
  }, [trend.models]);

  const shown = (methods || []).filter((m) => m.type === methodType);
  const remaining = models.filter((m) => m !== exampleModel);

  const create = async () => {
    setBusy(true);
    try {
      await api("POST", {
        trendId: trend.id,
        methodService: method?.service ?? null,
        methodId: method?.id ?? null,
        assigneeId,
        models,
        exampleModel: exampleModel || null,
        exampleUrl,
        notes,
        dueDate,
      });
      toast.success("Task assigned");
      await onCreated();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not assign");
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="glass-strong border-white/10 sm:max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Assign: {shortLink(trend.url)}</DialogTitle>
        </DialogHeader>

        <div className="space-y-5">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Method</p>
              <div className="glass rounded-lg p-0.5 flex text-xs ml-auto">
                {(["video", "image"] as const).map((t) => (
                  <button
                    key={t}
                    onClick={() => setMethodType(t)}
                    className={cn(
                      "px-2.5 py-1 rounded-md capitalize",
                      methodType === t ? "bg-white/10 text-foreground" : "text-muted-foreground"
                    )}
                  >
                    {t}s
                  </button>
                ))}
              </div>
            </div>
            {methods === null ? (
              <Skeleton className="h-28 rounded-xl" />
            ) : shown.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                No saved {methodType} methods. Save generations on the Methods page (Higgsfield or Yapper) first.
              </p>
            ) : (
              <div className="grid grid-cols-4 sm:grid-cols-6 gap-2 max-h-56 overflow-y-auto pr-1">
                {shown.map((m) => {
                  const src = m.thumbnailPath || m.outputPath;
                  const on = method?.service === m.service && method.id === m.id;
                  return (
                    <button
                      key={`${m.service}:${m.id}`}
                      onClick={() => setMethod(on ? null : m)}
                      title={m.prompt}
                      className={cn(
                        "relative aspect-[3/4] rounded-lg overflow-hidden bg-black/40 ring-2 transition",
                        on ? "ring-brand" : "ring-transparent hover:ring-white/20"
                      )}
                    >
                      {src &&
                        (m.type === "video" && !m.thumbnailPath ? (
                          <video src={`${fileUrl(src)}#t=0.5`} preload="metadata" muted className="h-full w-full object-cover" />
                        ) : (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={fileUrl(src)} alt="" className="h-full w-full object-cover" />
                        ))}
                      <span className="absolute bottom-0 inset-x-0 bg-black/60 text-[9px] py-0.5 capitalize">
                        {m.service}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
            {method && <MethodPreview method={method} />}
          </div>

          <div className="grid sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Content creator</p>
              <select
                value={assigneeId}
                onChange={(e) => setAssigneeId(e.target.value ? Number(e.target.value) : "")}
                className="w-full glass border border-white/10 rounded-md h-9 px-2 text-sm bg-transparent"
              >
                <option value="" className="bg-card">Pick someone</option>
                {[...creators, ...others].map((p) => (
                  <option key={p.id} value={p.id} className="bg-card">
                    {p.name} ({ROLE_LABEL[p.role] ?? p.role})
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Due</p>
              <Input
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="glass border-white/10 h-9 text-sm"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Models to make it for</p>
            <ChipPicker options={allModels} value={models} onChange={setModels} />
          </div>

          <div className="grid sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Your example is for
              </p>
              <select
                value={exampleModel}
                onChange={(e) => setExampleModel(e.target.value)}
                className="w-full glass border border-white/10 rounded-md h-9 px-2 text-sm bg-transparent"
              >
                <option value="" className="bg-card">No example</option>
                {models.map((m) => (
                  <option key={m} value={m} className="bg-card">
                    {m}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Example link</p>
              <Input
                value={exampleUrl}
                onChange={(e) => setExampleUrl(e.target.value)}
                placeholder="Drive link to the example you made"
                className="glass border-white/10 h-9 text-sm"
              />
            </div>
          </div>

          <Textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Notes for the creator (optional)"
            className="glass border-white/10 text-sm"
          />

          <p className="text-xs text-muted-foreground">
            {remaining.length > 0
              ? `The creator makes ${remaining.length}: ${remaining.join(", ")}.`
              : "Pick at least one model besides the example."}
          </p>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={create}
            disabled={busy || !assigneeId || remaining.length === 0 || !dueDate}
            className="rounded-xl bg-brand hover:bg-brand/90 text-brand-foreground gap-2"
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            Assign task
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
