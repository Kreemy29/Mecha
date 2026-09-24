"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  CheckCircleIcon,
  ClipboardTextIcon,
  CopyIcon,
  ArrowSquareOutIcon,
  PaperPlaneTiltIcon,
  SpinnerGapIcon,
  ThumbsDownIcon,
  ThumbsUpIcon,
  TrashIcon,
  MagicWandIcon,
  PlayIcon,
} from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
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
} from "@/components/department/shared";
import { ReelPreview } from "@/components/department/reel-preview";

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

interface MediaRef {
  role: string;
  url: string;
  type?: string;
}

interface Method {
  service: "higgsfield" | "yapper";
  id: string;
  type: string;
  model: string;
  prompt: string;
  outputPath: string | null;
  thumbnailPath: string | null;
  medias: MediaRef[];
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
const isVideoRef = (m: MediaRef) =>
  (m.type ?? "").includes("video") || /\.(mp4|mov|webm)(\?|$)/i.test(m.url);

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

  const openCount = tasks.filter((t) => !isDone(t)).length;
  const toReview = tasks.reduce((n, t) => n + t.items.filter((i) => i.status === "submitted").length, 0);

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
        eyebrow="Department"
        title="Production"
        subtitle={
          manager
            ? "Turn approved trends into tasks: pick the method, the creator and the models, show one example."
            : seesAll
              ? "Everything in production, and what's been handed in."
              : "Your assigned videos. Make one per model and hand each in as a Drive link."
        }
      >
        {!loading && (
          <div className="flex items-center gap-4 text-sm text-muted-foreground">
            <span>
              <span className="tnum font-semibold text-foreground">{openCount}</span> in progress
            </span>
            {manager && (
              <span>
                <span className="tnum font-semibold text-chart-2">{toReview}</span> to review
              </span>
            )}
          </div>
        )}
      </PageHeader>

      <WorkBanners />

      {seesAll && (
        <Card className="gap-0 p-0">
          <SectionHead Icon={MagicWandIcon} title="Approved trends waiting for a method" count={waiting.length} />
          <div className="p-4">
            {loading ? (
              <Skeleton className="h-40 rounded-xl" />
            ) : waiting.length === 0 ? (
              <Empty title="Nothing waiting" hint="Approved trends from the last 30 days show up here." />
            ) : (
              <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
                {waiting.map((t) => (
                  <div key={t.id} className="flex gap-3 rounded-xl border border-border bg-background/40 p-3">
                    <ReelPreview url={t.url} kind={t.kind} className="w-24 shrink-0 self-start" />
                    <div className="flex min-w-0 flex-1 flex-col gap-2">
                      <div>
                        <p className="truncate text-sm font-semibold">{t.niche || "No niche"}</p>
                        <p className="text-xs text-muted-foreground">
                          {prettyDate(t.date)} · by {t.createdBy}
                        </p>
                      </div>
                      <p className="line-clamp-3 text-xs text-muted-foreground">{t.justification}</p>
                      <div className="flex flex-wrap gap-1">
                        {t.models.map((m) => (
                          <span key={m} className="rounded-md bg-secondary px-1.5 py-0.5 text-[11px] font-medium">
                            {m}
                          </span>
                        ))}
                      </div>
                      {manager && (
                        <Button
                          size="sm"
                          onClick={() => setAssigning(t)}
                          className="mt-auto self-start bg-brand text-brand-foreground hover:bg-brand/90"
                        >
                          Assign
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </Card>
      )}

      <Card className="gap-0 p-0">
        <SectionHead Icon={ClipboardTextIcon} title={seesAll ? "Tasks" : "My tasks"} count={visible.length}>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <div className="inline-flex rounded-lg border border-border bg-card p-0.5 text-sm">
              {[false, true].map((done) => (
                <button
                  key={String(done)}
                  onClick={() => setShowDone(done)}
                  className={cn(
                    "rounded-md px-3 py-1 font-medium transition-colors",
                    showDone === done ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground"
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
                className="h-8 rounded-lg border border-border bg-card px-2 text-sm"
              >
                <option value="all">Everyone</option>
                {assignees.map(([id, name]) => (
                  <option key={id} value={id}>
                    {name}
                  </option>
                ))}
              </select>
            )}
          </div>
        </SectionHead>
        <div className="space-y-4 p-4">
          {loading ? (
            <Skeleton className="h-64 rounded-xl" />
          ) : visible.length === 0 ? (
            <Empty
              title={showDone ? "Nothing fully approved yet" : "No tasks in progress"}
              hint={manager && !showDone ? "Assign an approved trend above to create one." : undefined}
            />
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
        </div>
      </Card>

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

function SectionHead({
  Icon,
  title,
  count,
  children,
}: {
  Icon: typeof MagicWandIcon;
  title: string;
  count: number;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2.5 border-b border-border px-5 py-3.5">
      <span className="grid size-8 place-items-center rounded-lg bg-brand/10 text-brand">
        <Icon weight="bold" className="size-4" />
      </span>
      <h2 className="text-base font-semibold">{title}</h2>
      <span className="tnum rounded-full bg-secondary px-2 py-0.5 text-xs font-medium text-muted-foreground">
        {count}
      </span>
      {children}
    </div>
  );
}

function Empty({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-dashed border-border px-6 py-10 text-center">
      <p className="text-sm font-medium">{title}</p>
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

// The photos/videos the method's generation was made from.
function ReferenceStrip({ medias }: { medias: MediaRef[] }) {
  if (medias.length === 0) return null;
  return (
    <div className="space-y-1.5">
      <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        References used ({medias.length})
      </p>
      <div className="flex flex-wrap gap-2">
        {medias.map((m, i) => (
          <a
            key={i}
            href={m.url}
            target="_blank"
            rel="noreferrer"
            title={`${m.role} — open full size`}
            className="group relative size-16 overflow-hidden rounded-lg border border-border bg-black"
          >
            {isVideoRef(m) ? (
              <>
                <video src={`${m.url}#t=0.5`} preload="metadata" muted playsInline className="size-full object-cover" />
                <PlayIcon weight="fill" className="absolute right-1 top-1 size-3 text-white drop-shadow" />
              </>
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={m.url} alt={m.role} loading="lazy" className="size-full object-cover" />
            )}
            <span className="absolute inset-x-0 bottom-0 truncate bg-black/60 px-1 py-0.5 text-center text-[9px] text-white">
              {m.role.replace(/_/g, " ")}
            </span>
          </a>
        ))}
      </div>
    </div>
  );
}

function MethodPreview({ method, compact = false }: { method: Method; compact?: boolean }) {
  const src = method.outputPath ? fileUrl(method.outputPath) : null;
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="space-y-3">
      <div className="flex gap-3">
        <div className="aspect-[9/16] w-20 shrink-0 overflow-hidden rounded-lg bg-black">
          {src &&
            (method.type === "video" ? (
              <video src={src} controls muted playsInline className="size-full object-cover" />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={src} alt="" className="size-full object-cover" />
            ))}
        </div>
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="rounded-md bg-secondary px-1.5 py-0.5 text-[11px] font-medium capitalize">
              {method.service}
            </span>
            <span className="text-sm font-semibold break-all">{method.model}</span>
            <button
              onClick={() => {
                navigator.clipboard.writeText(method.prompt);
                toast.success("Prompt copied");
              }}
              className="ml-auto inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <CopyIcon className="size-3.5" /> Copy prompt
            </button>
          </div>
          <p
            className={cn(
              "whitespace-pre-wrap text-xs text-muted-foreground",
              !expanded && (compact ? "line-clamp-3" : "line-clamp-5")
            )}
          >
            {method.prompt || "(no prompt)"}
          </p>
          {method.prompt.length > 240 && (
            <button onClick={() => setExpanded((e) => !e)} className="text-xs font-medium text-brand hover:underline">
              {expanded ? "Show less" : "Show full prompt"}
            </button>
          )}
        </div>
      </div>
      <ReferenceStrip medias={method.medias ?? []} />
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
  const pct = t.items.length ? Math.round((done / t.items.length) * 100) : 0;

  return (
    <div className="rounded-xl border border-border bg-background/40">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border px-4 py-3">
        <p className="text-sm font-semibold">{t.trend?.niche || "Task"}</p>
        {t.trend && (
          <span className="rounded-md bg-secondary px-1.5 py-0.5 text-[11px] font-medium capitalize">{t.trend.kind}</span>
        )}
        <span className={cn("text-xs", overdue ? "font-medium text-destructive" : "text-muted-foreground")}>
          Due {prettyDate(t.dueDate)}
          {overdue && " · overdue"}
        </span>
        <div className="ml-auto flex items-center gap-3">
          {(manager || !mine) && <span className="text-xs text-muted-foreground">{t.assignee}</span>}
          <div className="flex items-center gap-2">
            <div className="h-1.5 w-20 overflow-hidden rounded-full bg-secondary">
              <div className="h-full rounded-full bg-[var(--pass)] transition-all" style={{ width: `${pct}%` }} />
            </div>
            <span className="tnum text-xs text-muted-foreground">
              {done}/{t.items.length}
            </span>
          </div>
          {manager && (
            <Button size="icon-sm" variant="ghost" onClick={onDelete} title="Delete task" className="hover:text-destructive">
              <TrashIcon className="size-4" />
            </Button>
          )}
        </div>
      </div>

      {/* Body: reference reel · how to make it · one row per model */}
      <div className="grid gap-5 p-4 lg:grid-cols-[8rem_minmax(0,1fr)_minmax(0,22rem)]">
        <div className="space-y-1.5">
          <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Original</p>
          {t.trend ? (
            <ReelPreview url={t.trend.url} kind={t.trend.kind} className="w-32 max-lg:w-28" />
          ) : (
            <p className="text-xs text-muted-foreground">Trend deleted</p>
          )}
        </div>

        <div className="min-w-0 space-y-4">
          <div className="space-y-1.5">
            <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Method</p>
            {t.method ? (
              <MethodPreview method={t.method} />
            ) : (
              <p className="text-xs text-muted-foreground">No method attached.</p>
            )}
          </div>

          {(t.exampleModel || t.exampleUrl) && (
            <div className="flex items-center gap-3 rounded-lg border border-brand/25 bg-brand/[0.06] px-3 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="text-[10px] font-medium uppercase tracking-wide text-brand">Example</p>
                <p className="text-sm font-medium">{t.exampleModel ? `Made for ${t.exampleModel}` : "Reference example"}</p>
              </div>
              {t.exampleUrl && /^https?:\/\//i.test(t.exampleUrl) && (
                <a
                  href={t.exampleUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border bg-card px-2 py-1 text-xs font-medium hover:bg-accent"
                >
                  Open <ArrowSquareOutIcon className="size-3.5" />
                </a>
              )}
            </div>
          )}

          {t.notes && (
            <div className="rounded-lg bg-secondary/50 px-3 py-2">
              <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Notes</p>
              <p className="mt-0.5 whitespace-pre-wrap text-sm">{t.notes}</p>
            </div>
          )}
        </div>

        <div className="space-y-2">
          <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            To make · {t.items.length} model{t.items.length === 1 ? "" : "s"}
          </p>
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
    <div
      className={cn(
        "space-y-2 rounded-lg border p-2.5",
        i.status === "approved" ? "border-[var(--pass)]/25 bg-[var(--pass)]/[0.04]" : "border-border bg-card"
      )}
    >
      <div className="flex items-center gap-2">
        <span className="text-sm font-semibold">{i.model}</span>
        <StatusBadge status={i.status} />
        {i.driveUrl && (
          <a
            href={i.driveUrl}
            target="_blank"
            rel="noreferrer"
            className="ml-auto inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            Open <ArrowSquareOutIcon className="size-3.5" />
          </a>
        )}
      </div>
      {i.reviewNote && (
        <p className="rounded-md border border-destructive/25 bg-destructive/5 px-2.5 py-1.5 text-xs text-destructive">
          <span className="font-semibold">{i.reviewedBy}:</span> {i.reviewNote}
        </p>
      )}
      {canSubmit && (
        <div className="flex gap-1.5">
          <Input
            value={link}
            onChange={(e) => setLink(e.target.value)}
            placeholder="Google Drive link"
            className="h-8 text-sm"
          />
          <Button
            size="sm"
            disabled={busy || !link.trim() || (link.trim() === i.driveUrl && i.status === "submitted")}
            onClick={() => run("submit", { driveUrl: link })}
            className="shrink-0 gap-1 bg-brand text-brand-foreground hover:bg-brand/90"
          >
            {busy ? <SpinnerGapIcon className="size-3.5 animate-spin" /> : <PaperPlaneTiltIcon className="size-3.5" />}
            {i.status === "submitted" ? "Update" : "Hand in"}
          </Button>
        </div>
      )}
      {manager && i.status === "submitted" && (
        <div className="flex justify-end gap-1.5">
          <Button
            size="sm"
            disabled={busy}
            onClick={() => run("approve")}
            className="gap-1 bg-[var(--pass)]/15 text-[var(--pass)] hover:bg-[var(--pass)]/25"
          >
            <ThumbsUpIcon weight="bold" className="size-3.5" /> Approve
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => {
              const note = window.prompt(`What needs fixing on ${i.model}?`);
              if (note !== null) run("reject", { note });
            }}
            className="gap-1 text-destructive hover:bg-destructive/10 hover:text-destructive"
          >
            <ThumbsDownIcon weight="bold" className="size-3.5" /> Reject
          </Button>
        </div>
      )}
      {i.status === "approved" && (
        <p className="flex items-center gap-1 text-xs text-[var(--pass)]">
          <CheckCircleIcon weight="fill" className="size-3.5" /> Approved by {i.reviewedBy}
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

  const label = "text-xs font-medium text-muted-foreground";

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>Assign a task</DialogTitle>
        </DialogHeader>

        <div className="grid gap-6 md:grid-cols-[9rem_minmax(0,1fr)]">
          <div className="space-y-2">
            <ReelPreview url={trend.url} kind={trend.kind} className="w-36 max-md:w-28" />
            <p className="truncate text-sm font-semibold">{trend.niche || "No niche"}</p>
            <p className="line-clamp-4 text-xs text-muted-foreground">{trend.justification}</p>
          </div>

          <div className="space-y-5">
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <p className={label}>Method</p>
                <div className="ml-auto inline-flex rounded-lg border border-border bg-card p-0.5 text-xs">
                  {(["video", "image"] as const).map((t) => (
                    <button
                      key={t}
                      onClick={() => setMethodType(t)}
                      className={cn(
                        "rounded-md px-2.5 py-1 font-medium capitalize",
                        methodType === t ? "bg-secondary text-foreground" : "text-muted-foreground"
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
                <div className="grid max-h-56 grid-cols-4 gap-2 overflow-y-auto pr-1 sm:grid-cols-6">
                  {shown.map((m) => {
                    const src = m.thumbnailPath || m.outputPath;
                    const on = method?.service === m.service && method.id === m.id;
                    return (
                      <button
                        key={`${m.service}:${m.id}`}
                        onClick={() => setMethod(on ? null : m)}
                        title={m.prompt}
                        className={cn(
                          "relative aspect-[3/4] overflow-hidden rounded-lg bg-black ring-2 transition",
                          on ? "ring-brand" : "ring-transparent hover:ring-border"
                        )}
                      >
                        {src &&
                          (m.type === "video" && !m.thumbnailPath ? (
                            <video src={`${fileUrl(src)}#t=0.5`} preload="metadata" muted className="size-full object-cover" />
                          ) : (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={fileUrl(src)} alt="" className="size-full object-cover" />
                          ))}
                        <span className="absolute inset-x-0 bottom-0 bg-black/60 py-0.5 text-[9px] capitalize text-white">
                          {m.service}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
              {method && (
                <div className="rounded-xl border border-border bg-background/40 p-3">
                  <MethodPreview method={method} compact />
                </div>
              )}
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <p className={label}>Content creator</p>
                <select
                  value={assigneeId}
                  onChange={(e) => setAssigneeId(e.target.value ? Number(e.target.value) : "")}
                  className="h-9 w-full rounded-lg border border-border bg-card px-2 text-sm"
                >
                  <option value="">Pick someone</option>
                  {[...creators, ...others].map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({ROLE_LABEL[p.role] ?? p.role})
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <p className={label}>Due</p>
                <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
              </div>
            </div>

            <div className="space-y-1.5">
              <p className={label}>Models to make it for</p>
              <ChipPicker options={allModels} value={models} onChange={setModels} />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <p className={label}>Your example is for</p>
                <select
                  value={exampleModel}
                  onChange={(e) => setExampleModel(e.target.value)}
                  className="h-9 w-full rounded-lg border border-border bg-card px-2 text-sm"
                >
                  <option value="">No example</option>
                  {models.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <p className={label}>Example link</p>
                <Input
                  value={exampleUrl}
                  onChange={(e) => setExampleUrl(e.target.value)}
                  placeholder="Drive link to the example you made"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <p className={label}>Notes for the creator</p>
              <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" />
            </div>

            <p className="rounded-lg bg-secondary/50 px-3 py-2 text-sm">
              {remaining.length > 0 ? (
                <>
                  The creator makes <span className="font-semibold">{remaining.length}</span>: {remaining.join(", ")}.
                </>
              ) : (
                <span className="text-muted-foreground">Pick at least one model besides the example.</span>
              )}
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={create}
            disabled={busy || !assigneeId || remaining.length === 0 || !dueDate}
            className="gap-2 bg-brand text-brand-foreground hover:bg-brand/90"
          >
            {busy && <SpinnerGapIcon className="size-4 animate-spin" />}
            Assign task
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
