"use client";

import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Clapperboard,
  GalleryHorizontalEnd,
  ExternalLink,
  Loader2,
  Pencil,
  Plus,
  ThumbsDown,
  ThumbsUp,
  Trash2,
  Undo2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { can } from "@/lib/roles";
import { addDays, parseLocalDate, todayLocal } from "@/lib/day";
import { useMe } from "@/components/layout/me-context";
import {
  ChipPicker,
  DayPicker,
  PageHeader,
  StatusBadge,
  WorkBanners,
  shortLink,
} from "@/components/department/shared";

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

const SECTIONS: { kind: Kind; label: string; icon: typeof Clapperboard }[] = [
  { kind: "reel", label: "Reels", icon: Clapperboard },
  { kind: "carousel", label: "Carousels", icon: GalleryHorizontalEnd },
];

// Monday of the week containing `date`.
function weekStart(date: string): string {
  const day = (parseLocalDate(date).getDay() + 6) % 7;
  return addDays(date, -day);
}

export default function TrendsPage() {
  const { me } = useMe();
  const [date, setDate] = useState(todayLocal());
  const [trends, setTrends] = useState<Trend[]>([]);
  const [counts, setCounts] = useState<DayCount[]>([]);
  const [loading, setLoading] = useState(true);
  const [models, setModels] = useState<string[]>([]);
  const [niches, setNiches] = useState<string[]>([]);
  const [researcher, setResearcher] = useState<number | "all">("all");

  const week = useMemo(() => {
    const start = weekStart(date);
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

  return (
    <div className="space-y-6">
      <PageHeader
        title="Trends"
        subtitle={
          reviewer
            ? "Daily trend suggestions from research. Approve the ones worth producing."
            : "Pick the day, drop your reel and carousel finds, assign models and say why they'll go viral."
        }
      >
        <DayPicker date={date} onChange={setDate} />
      </PageHeader>

      <WorkBanners />

      {/* Week strip */}
      <div className="grid grid-cols-7 gap-1.5">
        {week.map((d) => {
          const c = counts.find((x) => x.date === d);
          const day = parseLocalDate(d);
          return (
            <button
              key={d}
              onClick={() => setDate(d)}
              className={cn(
                "glass rounded-xl px-2 py-2 text-left transition-colors",
                d === date
                  ? "ring-1 ring-brand bg-brand/10"
                  : "hover:bg-white/5"
              )}
            >
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                {day.toLocaleDateString(undefined, { weekday: "short" })}
                {d === todayLocal() && " · today"}
              </p>
              <p className="text-sm font-semibold">{day.getDate()}</p>
              <p className="text-[10px] text-muted-foreground">
                {c ? (
                  <>
                    {c.total} in · <span className="text-emerald-300">{c.approved} ok</span>
                    {c.pending > 0 && <span className="text-amber-300"> · {c.pending} wait</span>}
                  </>
                ) : (
                  "nothing yet"
                )}
              </p>
            </button>
          );
        })}
      </div>

      {reviewer && researchers.length > 1 && (
        <div className="flex items-center gap-2 text-xs">
          <span className="text-muted-foreground">Researcher:</span>
          {[["all", "Everyone"] as const, ...researchers].map(([id, name]) => (
            <button
              key={id}
              onClick={() => setResearcher(id)}
              className={cn(
                "px-2.5 py-1 rounded-lg border",
                researcher === id
                  ? "border-brand/50 bg-brand/15"
                  : "border-white/10 text-muted-foreground"
              )}
            >
              {name}
            </button>
          ))}
        </div>
      )}

      <div className="grid lg:grid-cols-2 gap-6">
        {SECTIONS.map(({ kind, label, icon: Icon }) => {
          const list = visible.filter((t) => t.kind === kind);
          return (
            <section key={kind} className="space-y-3">
              <h3 className="text-sm font-semibold flex items-center gap-2">
                <Icon className="h-4 w-4 text-brand" />
                {label}
                <Badge className="bg-white/10 border-0 text-[10px]">{list.length}</Badge>
              </h3>

              {suggester && (
                <AddTrend
                  kind={kind}
                  models={models}
                  niches={niches}
                  onSubmit={(draft) => create(kind, draft)}
                />
              )}

              {loading ? (
                <Skeleton className="h-32 rounded-xl" />
              ) : list.length === 0 ? (
                <div className="glass rounded-xl p-6 text-center text-sm text-muted-foreground">
                  No {label.toLowerCase()} for this day.
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
            </section>
          );
        })}
      </div>
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
    <div className="space-y-3">
      <Input
        value={draft.url}
        onChange={(e) => set("url", e.target.value)}
        placeholder="Instagram link (https://www.instagram.com/reel/...)"
        className="glass border-white/10 h-9 text-sm"
      />
      <div>
        <Input
          value={draft.niche}
          onChange={(e) => set("niche", e.target.value)}
          placeholder="Niche (pick or type a new one)"
          list={listId}
          className="glass border-white/10 h-9 text-sm"
        />
        <datalist id={listId}>
          {niches.map((n) => (
            <option key={n} value={n} />
          ))}
        </datalist>
      </div>
      <div className="space-y-1.5">
        <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Models</p>
        <ChipPicker
          options={models}
          value={draft.models}
          onChange={(v) => set("models", v)}
          empty="No models yet. Add them on the Instagram page or Characters."
        />
      </div>
      <Textarea
        value={draft.justification}
        onChange={(e) => set("justification", e.target.value)}
        placeholder="Why do you think it will go viral?"
        className="glass border-white/10 text-sm min-h-20"
      />
      <div className="flex justify-end gap-2">
        {onCancel && (
          <Button variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </Button>
        )}
        <Button
          size="sm"
          onClick={submit}
          disabled={busy || !draft.url.trim() || draft.models.length === 0 || !draft.justification.trim()}
          className="rounded-lg bg-brand hover:bg-brand/90 text-brand-foreground gap-1.5"
        >
          {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          {submitLabel}
        </Button>
      </div>
    </div>
  );
}

function AddTrend({
  kind,
  models,
  niches,
  onSubmit,
}: {
  kind: Kind;
  models: string[];
  niches: string[];
  onSubmit: (d: Draft) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="w-full glass rounded-xl px-4 py-3 text-sm text-muted-foreground hover:text-foreground hover:bg-white/5 flex items-center gap-2 border border-dashed border-white/10"
      >
        <Plus className="h-4 w-4" /> Add a {kind}
      </button>
    );
  }
  return (
    <div className="glass-strong rounded-xl p-4 space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium">New {kind}</p>
        <button onClick={() => setOpen(false)} className="text-muted-foreground hover:text-foreground">
          <X className="h-4 w-4" />
        </button>
      </div>
      <TrendForm
        initial={EMPTY}
        models={models}
        niches={niches}
        submitLabel={`Submit ${kind}`}
        onSubmit={onSubmit}
      />
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
      <div className="glass-strong rounded-xl p-4">
        <TrendForm
          initial={{
            url: t.url,
            niche: t.niche || "",
            models: t.models,
            justification: t.justification,
          }}
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
        "glass rounded-xl p-4 space-y-3 border",
        t.status === "approved"
          ? "border-emerald-500/25"
          : t.status === "rejected"
            ? "border-red-500/25"
            : "border-white/5"
      )}
    >
      <div className="flex items-start gap-2">
        <a
          href={t.url}
          target="_blank"
          rel="noreferrer"
          className="text-sm font-medium hover:underline underline-offset-2 flex items-center gap-1.5 min-w-0 flex-1"
        >
          <ExternalLink className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <span className="truncate">{shortLink(t.url)}</span>
        </a>
        <StatusBadge status={t.status} />
      </div>

      <div className="flex flex-wrap gap-1.5">
        {t.niche && (
          <Badge className="bg-[oklch(0.75_0.15_200_/_15%)] text-[oklch(0.85_0.1_200)] border-0 text-[10px]">
            {t.niche}
          </Badge>
        )}
        {t.models.map((m) => (
          <Badge key={m} className="bg-white/10 border-0 text-[10px]">
            {m}
          </Badge>
        ))}
      </div>

      <p className="text-sm text-foreground/90 whitespace-pre-wrap">{t.justification}</p>

      {t.reviewNote && (
        <p className="text-xs rounded-lg bg-red-500/10 text-red-200 px-3 py-2">
          <span className="font-medium">{t.reviewedBy}:</span> {t.reviewNote}
        </p>
      )}

      <div className="flex items-center gap-1.5 pt-1">
        <span className="text-[11px] text-muted-foreground flex-1">
          by {t.createdBy}
          {t.reviewedBy && t.status !== "pending" && ` · ${t.status} by ${t.reviewedBy}`}
        </span>
        {reviewer && t.status !== "approved" && (
          <Button
            size="sm"
            onClick={() => onReview("approved")}
            className="h-7 px-2 text-xs rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-200 gap-1"
          >
            <ThumbsUp className="h-3 w-3" /> Approve
          </Button>
        )}
        {reviewer && t.status !== "rejected" && (
          <Button
            size="sm"
            onClick={() => onReview("rejected")}
            className="h-7 px-2 text-xs rounded-lg bg-red-500/15 hover:bg-red-500/25 text-red-200 gap-1"
          >
            <ThumbsDown className="h-3 w-3" /> Reject
          </Button>
        )}
        {reviewer && t.status !== "pending" && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => onReview("pending")}
            title="Undo review"
            className="h-7 w-7 p-0"
          >
            <Undo2 className="h-3.5 w-3.5" />
          </Button>
        )}
        {canChange && (
          <>
            <Button size="sm" variant="ghost" onClick={() => setEditing(true)} className="h-7 w-7 p-0" title="Edit">
              <Pencil className="h-3.5 w-3.5" />
            </Button>
            <Button size="sm" variant="ghost" onClick={onDelete} className="h-7 w-7 p-0 hover:text-red-300" title="Delete">
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
