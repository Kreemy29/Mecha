"use client";

import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  FilmStripIcon,
  ImagesIcon,
  PencilSimpleIcon,
  PlusIcon,
  SpinnerGapIcon,
  ThumbsDownIcon,
  ThumbsUpIcon,
  TrashIcon,
  ArrowCounterClockwiseIcon,
  XIcon,
} from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { can } from "@/lib/roles";
import { addDays, parseLocalDate, startOfWeek, todayLocal } from "@/lib/day";
import { useMe } from "@/components/layout/me-context";
import {
  ChipPicker,
  DayPicker,
  PageHeader,
  StatusBadge,
  WorkBanners,
  shortLink,
} from "@/components/department/shared";
import { ReelPreview } from "@/components/department/reel-preview";

type Kind = "reel" | "carousel";
type ReviewStatus = "pending" | "approved" | "rejected";

interface Trend {
  id: number;
  date: string;
  kind: Kind;
  url: string;
  niche: string | null;
  models: string[];
  justification: string;
  status: ReviewStatus;
  reviewNote: string | null;
  reviewedBy: string | null;
  createdById: number;
  createdBy: string;
}

interface DayCount {
  date: string;
  total: number;
  approved: number;
  pending: number;
}

interface Draft {
  url: string;
  niche: string;
  models: string[];
  justification: string;
}

const EMPTY: Draft = { url: "", niche: "", models: [], justification: "" };

const SECTIONS: { kind: Kind; label: string; Icon: typeof FilmStripIcon }[] = [
  { kind: "reel", label: "Reels", Icon: FilmStripIcon },
  { kind: "carousel", label: "Carousels", Icon: ImagesIcon },
];

export default function TrendsPage() {
  const { me } = useMe();
  const [date, setDate] = useState(todayLocal());
  const [trends, setTrends] = useState<Trend[]>([]);
  const [counts, setCounts] = useState<DayCount[]>([]);
  const [loading, setLoading] = useState(true);
  const [models, setModels] = useState<string[]>([]);
  const [niches, setNiches] = useState<string[]>([]);
  const [researcher, setResearcher] = useState<number | "all">("all");
  const [adding, setAdding] = useState<Kind | null>(null);

  const week = useMemo(() => {
    const start = startOfWeek(date);
    return Array.from({ length: 7 }, (_, i) => addDays(start, i));
  }, [date]);

  const load = useCallback(async () => {
    const [list, c] = await Promise.all([
      fetch(`/api/trends?date=${date}`).then((r) => r.json()),
      fetch(`/api/trends?counts=1&from=${week[0]}&to=${week[6]}`).then((r) => r.json()),
    ]);
    setTrends(Array.isArray(list) ? list : []);
    setCounts(Array.isArray(c) ? c : []);
    setLoading(false);
  }, [date, week]);

  useEffect(() => {
    (async () => {
      await load();
    })();
  }, [load]);

  useEffect(() => {
    fetch("/api/instagram/taxonomy")
      .then((r) => r.json())
      .then((d) => {
        setModels(d.models || []);
        setNiches(d.niches || []);
      })
      .catch(() => {});
  }, []);

  const reviewer = !!me && can.reviewTrends(me);
  const suggester = !!me && can.suggestTrends(me);

  const researchers = useMemo(() => {
    const m = new Map<number, string>();
    for (const t of trends) m.set(t.createdById, t.createdBy);
    return [...m.entries()];
  }, [trends]);

  const visible = trends.filter((t) => researcher === "all" || t.createdById === researcher);

  const replace = (t: Trend) => setTrends((prev) => prev.map((x) => (x.id === t.id ? t : x)));

  const send = async (method: string, body?: unknown, query = "") => {
    const res = await fetch(`/api/trends${query}`, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    return data;
  };

  const create = async (kind: Kind, draft: Draft) => {
    const row = await send("POST", { ...draft, kind, date });
    setTrends((prev) => [row, ...prev]);
    if (draft.niche && !niches.includes(draft.niche)) setNiches((n) => [...n, draft.niche].sort());
    setAdding(null);
    load();
  };

  const review = async (t: Trend, status: ReviewStatus) => {
    let note: string | null = null;
    if (status === "rejected") {
      note = window.prompt("Why is it rejected? (the researcher sees this)") ?? null;
      if (note === null) return;
    }
    try {
      replace(await send("PATCH", { id: t.id, review: status, note }));
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Review failed");
    }
  };

  const edit = async (t: Trend, draft: Draft) => {
    replace(await send("PATCH", { id: t.id, ...draft, kind: t.kind, date: t.date }));
    load();
  };

  const remove = async (t: Trend) => {
    if (!confirm("Delete this suggestion?")) return;
    try {
      await send("DELETE", undefined, `?id=${t.id}`);
      setTrends((prev) => prev.filter((x) => x.id !== t.id));
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Delete failed");
    }
  };

  const dayTotal = visible.length;
  const dayApproved = visible.filter((t) => t.status === "approved").length;
  const dayPending = visible.filter((t) => t.status === "pending").length;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Department"
        title="Trends"
        subtitle={
          reviewer
            ? "Daily finds from research. Approve the ones worth producing."
            : "Pick the day, add your reel and carousel finds, assign models and say why they'll go viral."
        }
      >
        <DayPicker date={date} onChange={setDate} />
      </PageHeader>

      <WorkBanners />

      {/* Week at a glance */}
      <Card className="gap-0 p-1.5">
        <div className="grid grid-cols-7 gap-1">
          {week.map((d) => {
            const c = counts.find((x) => x.date === d);
            const day = parseLocalDate(d);
            const selected = d === date;
            const isToday = d === todayLocal();
            return (
              <button
                key={d}
                onClick={() => setDate(d)}
                className={cn(
                  "rounded-lg px-2 py-2 text-left transition-colors",
                  selected ? "bg-brand/10 ring-1 ring-brand/60" : "hover:bg-accent"
                )}
              >
                <p className={cn("text-[10px] font-medium uppercase tracking-wide", isToday ? "text-brand" : "text-muted-foreground")}>
                  {day.toLocaleDateString(undefined, { weekday: "short" })}
                  {isToday && " · today"}
                </p>
                <p className="tnum mt-0.5 text-lg font-semibold leading-none">{day.getDate()}</p>
                <div className="mt-1.5 flex h-4 items-center gap-1">
                  {c ? (
                    <>
                      <span className="tnum text-[11px] text-muted-foreground">{c.total}</span>
                      {c.approved > 0 && <span className="size-1.5 rounded-full bg-[var(--pass)]" title={`${c.approved} approved`} />}
                      {c.pending > 0 && <span className="size-1.5 rounded-full bg-[var(--review)]" title={`${c.pending} waiting`} />}
                    </>
                  ) : (
                    <span className="text-[11px] text-muted-foreground/50">–</span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </Card>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
        <span className="text-muted-foreground">
          <span className="tnum font-semibold text-foreground">{dayTotal}</span> suggested ·{" "}
          <span className="tnum font-semibold text-[var(--pass)]">{dayApproved}</span> approved ·{" "}
          <span className="tnum font-semibold text-[var(--review)]">{dayPending}</span> waiting
        </span>
        {reviewer && researchers.length > 1 && (
          <div className="ml-auto inline-flex rounded-lg border border-border bg-card p-0.5 text-sm">
            {[["all", "Everyone"] as const, ...researchers].map(([id, name]) => (
              <button
                key={id}
                onClick={() => setResearcher(id)}
                className={cn(
                  "rounded-md px-3 py-1 font-medium transition-colors",
                  researcher === id ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground"
                )}
              >
                {name}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        {SECTIONS.map(({ kind, label, Icon }) => {
          const list = visible.filter((t) => t.kind === kind);
          return (
            <Card key={kind} className="gap-0 p-0">
              <div className="flex items-center gap-2.5 border-b border-border px-5 py-3.5">
                <span className="grid size-8 place-items-center rounded-lg bg-brand/10 text-brand">
                  <Icon weight="bold" className="size-4" />
                </span>
                <h2 className="text-base font-semibold">{label}</h2>
                <span className="tnum rounded-full bg-secondary px-2 py-0.5 text-xs font-medium text-muted-foreground">
                  {list.length}
                </span>
                {suggester && adding !== kind && (
                  <Button size="sm" variant="outline" onClick={() => setAdding(kind)} className="ml-auto gap-1.5">
                    <PlusIcon weight="bold" className="size-3.5" /> Add {kind}
                  </Button>
                )}
              </div>

              <div className="space-y-3 p-4">
                {adding === kind && (
                  <div className="rounded-xl border border-brand/30 bg-brand/[0.04] p-4">
                    <div className="mb-3 flex items-center justify-between">
                      <p className="text-sm font-semibold">New {kind}</p>
                      <button
                        onClick={() => setAdding(null)}
                        className="text-muted-foreground hover:text-foreground"
                        aria-label="Cancel"
                      >
                        <XIcon className="size-4" />
                      </button>
                    </div>
                    <TrendForm
                      initial={EMPTY}
                      models={models}
                      niches={niches}
                      submitLabel={`Submit ${kind}`}
                      onSubmit={(draft) => create(kind, draft)}
                    />
                  </div>
                )}

                {loading ? (
                  <Skeleton className="h-44 rounded-xl" />
                ) : list.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-border px-6 py-10 text-center">
                    <p className="text-sm font-medium">No {label.toLowerCase()} for this day</p>
                    {suggester && adding !== kind && (
                      <p className="mt-1 text-xs text-muted-foreground">Use “Add {kind}” to put one forward.</p>
                    )}
                  </div>
                ) : (
                  list.map((t) => (
                    <TrendCard
                      key={t.id}
                      trend={t}
                      reviewer={reviewer}
                      mine={t.createdById === me?.id}
                      manager={!!me && can.manageProduction(me)}
                      models={models}
                      niches={niches}
                      onReview={(s) => review(t, s)}
                      onEdit={(d) => edit(t, d)}
                      onDelete={() => remove(t)}
                    />
                  ))
                )}
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      {children}
    </div>
  );
}

function TrendForm({
  initial,
  models,
  niches,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial: Draft;
  models: string[];
  niches: string[];
  submitLabel: string;
  onSubmit: (d: Draft) => Promise<void>;
  onCancel?: () => void;
}) {
  const [draft, setDraft] = useState<Draft>(initial);
  const [busy, setBusy] = useState(false);
  const listId = useId();
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => ({ ...d, [k]: v }));

  const submit = async () => {
    setBusy(true);
    try {
      await onSubmit(draft);
      setDraft(EMPTY);
      toast.success("Saved");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-[1fr_14rem]">
        <Field label="Instagram link">
          <Input
            value={draft.url}
            onChange={(e) => set("url", e.target.value)}
            placeholder="https://www.instagram.com/reel/..."
          />
        </Field>
        <Field label="Niche">
          <Input
            value={draft.niche}
            onChange={(e) => set("niche", e.target.value)}
            placeholder="Pick or type a new one"
            list={listId}
          />
          <datalist id={listId}>
            {niches.map((n) => (
              <option key={n} value={n} />
            ))}
          </datalist>
        </Field>
      </div>
      <Field label="Models">
        <ChipPicker
          options={models}
          value={draft.models}
          onChange={(v) => set("models", v)}
          empty="No models yet. Add them on the Instagram page or Characters."
        />
      </Field>
      <Field label="Why do you think it will go viral?">
        <Textarea
          value={draft.justification}
          onChange={(e) => set("justification", e.target.value)}
          placeholder="The hook, the trend it rides, why it fits these models…"
          className="min-h-20"
        />
      </Field>
      <div className="flex justify-end gap-2">
        {onCancel && (
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        )}
        <Button
          onClick={submit}
          disabled={busy || !draft.url.trim() || draft.models.length === 0 || !draft.justification.trim()}
          className="gap-1.5 bg-brand text-brand-foreground hover:bg-brand/90"
        >
          {busy && <SpinnerGapIcon className="size-4 animate-spin" />}
          {submitLabel}
        </Button>
      </div>
    </div>
  );
}

function TrendCard({
  trend: t,
  reviewer,
  mine,
  manager,
  models,
  niches,
  onReview,
  onEdit,
  onDelete,
}: {
  trend: Trend;
  reviewer: boolean;
  mine: boolean;
  manager: boolean;
  models: string[];
  niches: string[];
  onReview: (s: ReviewStatus) => void;
  onEdit: (d: Draft) => Promise<void>;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const canChange = (mine || manager) && t.status !== "approved";

  if (editing) {
    return (
      <div className="rounded-xl border border-brand/30 bg-brand/[0.04] p-4">
        <TrendForm
          initial={{ url: t.url, niche: t.niche || "", models: t.models, justification: t.justification }}
          models={[...new Set([...models, ...t.models])]}
          niches={niches}
          submitLabel="Save and resubmit"
          onSubmit={async (d) => {
            await onEdit(d);
            setEditing(false);
          }}
          onCancel={() => setEditing(false)}
        />
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex gap-4 rounded-xl border bg-background/40 p-3 transition-colors",
        t.status === "approved"
          ? "border-[var(--pass)]/30"
          : t.status === "rejected"
            ? "border-destructive/30"
            : "border-border"
      )}
    >
      <ReelPreview url={t.url} kind={t.kind} className="w-28 shrink-0 self-start sm:w-32" />

      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            {t.niche ? (
              <p className="truncate text-sm font-semibold">{t.niche}</p>
            ) : (
              <p className="text-sm font-semibold text-muted-foreground">No niche</p>
            )}
            <a
              href={t.url}
              target="_blank"
              rel="noreferrer"
              className="block truncate text-xs text-muted-foreground hover:text-foreground hover:underline"
            >
              {shortLink(t.url)}
            </a>
          </div>
          <StatusBadge status={t.status} />
        </div>

        <div className="flex flex-wrap gap-1">
          {t.models.map((m) => (
            <span key={m} className="rounded-md bg-secondary px-2 py-0.5 text-xs font-medium text-secondary-foreground">
              {m}
            </span>
          ))}
        </div>

        <div className="rounded-lg bg-secondary/50 px-3 py-2">
          <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Why it’ll go viral</p>
          <p className="mt-0.5 whitespace-pre-wrap text-sm">{t.justification}</p>
        </div>

        {t.reviewNote && (
          <p className="rounded-lg border border-destructive/25 bg-destructive/5 px-3 py-2 text-xs text-destructive">
            <span className="font-semibold">{t.reviewedBy}:</span> {t.reviewNote}
          </p>
        )}

        <div className="mt-auto flex flex-wrap items-center gap-1.5">
          <span className="mr-auto text-xs text-muted-foreground">
            by {t.createdBy}
            {t.reviewedBy && t.status !== "pending" && ` · ${t.status} by ${t.reviewedBy}`}
          </span>
          {reviewer && t.status !== "approved" && (
            <Button
              size="sm"
              onClick={() => onReview("approved")}
              className="gap-1 bg-[var(--pass)]/15 text-[var(--pass)] hover:bg-[var(--pass)]/25"
            >
              <ThumbsUpIcon weight="bold" className="size-3.5" /> Approve
            </Button>
          )}
          {reviewer && t.status !== "rejected" && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => onReview("rejected")}
              className="gap-1 text-destructive hover:bg-destructive/10 hover:text-destructive"
            >
              <ThumbsDownIcon weight="bold" className="size-3.5" /> Reject
            </Button>
          )}
          {reviewer && t.status !== "pending" && (
            <Button size="icon-sm" variant="ghost" onClick={() => onReview("pending")} title="Undo review">
              <ArrowCounterClockwiseIcon className="size-4" />
            </Button>
          )}
          {canChange && (
            <>
              <Button size="icon-sm" variant="ghost" onClick={() => setEditing(true)} title="Edit">
                <PencilSimpleIcon className="size-4" />
              </Button>
              <Button size="icon-sm" variant="ghost" onClick={onDelete} title="Delete" className="hover:text-destructive">
                <TrashIcon className="size-4" />
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
