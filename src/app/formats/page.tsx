"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import {
  Plus,
  X,
  Trash2,
  Link as LinkIcon,
  Upload,
  Loader2,
  Sparkles,
  Bookmark,
  ExternalLink,
  Clapperboard,
  CheckCircle2,
  MessageCircle,
  Send,
  CalendarDays,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";

const toIsoDate = (d: Date) => d.toISOString().slice(0, 10);

// ISO 8601 week number (Monday-start, week 1 contains the year's first
// Thursday) — matches how people actually talk about "week 37" day to day.
// Used only to prefill the new-week dialog with a sensible name + Mon-Sun
// range; the operator picks the real dates from the calendar inputs.
function isoWeekDefaults(offsetDays = 0): { label: string; from: string; to: string } {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = (date.getUTCDay() + 6) % 7; // 0 = Monday
  const thursday = new Date(date);
  thursday.setUTCDate(date.getUTCDate() - dayNum + 3);
  const firstThursday = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 4));
  const week =
    1 +
    Math.round(
      ((thursday.getTime() - firstThursday.getTime()) / 86400000 -
        3 +
        ((firstThursday.getUTCDay() + 6) % 7)) /
        7
    );
  const monday = new Date(date);
  monday.setUTCDate(date.getUTCDate() - dayNum);
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);
  return { label: `Week ${week}`, from: toIsoDate(monday), to: toIsoDate(sunday) };
}

function formatDateRange(from: string | null, to: string | null): string {
  if (!from) return "";
  const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
  const fromLabel = new Date(`${from}T00:00:00`).toLocaleDateString(undefined, opts);
  if (!to || to === from) return fromLabel;
  const toLabel = new Date(`${to}T00:00:00`).toLocaleDateString(undefined, opts);
  return `${fromLabel} – ${toLabel}`;
}

// SQLite's datetime('now') has no timezone marker; without the Z the browser
// reads it as local time and everything looks hours old.
function timeAgo(iso: string): string {
  const then = Date.parse(iso.includes("Z") ? iso : `${iso}Z`);
  if (Number.isNaN(then)) return "";
  const s = Math.floor((Date.now() - then) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

interface FormatWeek {
  id: number;
  label: string;
  startDate: string | null;
  endDate: string | null;
  createdAt: string;
}

interface Assignment {
  id: number;
  formatId: number;
  model: string;
  quota: number;
}

interface FormatRow {
  id: number;
  title: string;
  videoPath: string | null;
  thumbPath: string | null;
  sourceUrl: string | null;
  shortcode: string | null;
  notes: string | null;
  weekId: number | null;
  methodGenerationId: string | null;
  assignments: Assignment[];
}

interface SavedGeneration {
  higgsfieldId: string;
  type: string;
  model: string;
  prompt: string;
  outputPath: string | null;
  thumbnailPath: string | null;
}

interface IgMediaRow {
  id: number;
  shortcode: string;
  caption: string | null;
  thumbPath: string | null;
  videoPath: string | null;
}

interface FormatComment {
  id: number;
  formatId: number;
  author: string;
  body: string;
  createdAt: string;
}

const fileUrl = (p: string) => `/api/files/${p.replace(/\\/g, "/")}`;

type AddMode = "existing" | "link" | "upload";

export default function FormatsPage() {
  const [weeks, setWeeks] = useState<FormatWeek[]>([]);
  const [selectedWeekId, setSelectedWeekId] = useState<number | null>(null);
  const [formats, setFormats] = useState<FormatRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [weekDialogOpen, setWeekDialogOpen] = useState(false);
  const [weekName, setWeekName] = useState("");
  const [weekFrom, setWeekFrom] = useState("");
  const [weekTo, setWeekTo] = useState("");

  const [modelOptions, setModelOptions] = useState<string[]>([]);
  const [savedGens, setSavedGens] = useState<SavedGeneration[]>([]);
  const [savedMedia, setSavedMedia] = useState<IgMediaRow[]>([]);

  const [adding, setAdding] = useState(false);
  const [addMode, setAddMode] = useState<AddMode>("existing");
  const [addTitle, setAddTitle] = useState("");
  const [addUrl, setAddUrl] = useState("");
  const [addMediaId, setAddMediaId] = useState("");
  const [saving, setSaving] = useState(false);

  const [methodPickerFor, setMethodPickerFor] = useState<number | null>(null);
  const [assignFor, setAssignFor] = useState<number | null>(null);
  const [assignModel, setAssignModel] = useState("");
  const [assignQuota, setAssignQuota] = useState("1");

  const [openComments, setOpenComments] = useState<number | null>(null);
  const [comments, setComments] = useState<Record<number, FormatComment[]>>({});
  const [commentDraft, setCommentDraft] = useState("");
  const [postingComment, setPostingComment] = useState(false);

  const loadWeeks = useCallback(async () => {
    const res = await fetch("/api/format-weeks");
    const rows: FormatWeek[] = await res.json();
    setWeeks(rows);
    return rows;
  }, []);

  const loadFormats = useCallback(async (weekId: number) => {
    const res = await fetch(`/api/winning-formats?weekId=${weekId}`);
    const rows = await res.json();
    setFormats(Array.isArray(rows) ? rows : []);
  }, []);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const [weekRows] = await Promise.all([
          loadWeeks(),
          fetch("/api/instagram/taxonomy")
            .then((r) => r.json())
            .then((d) => setModelOptions(d.models || []))
            .catch(() => {}),
          fetch("/api/higgsfield/generations/saved")
            .then((r) => r.json())
            .then((d) => setSavedGens(d.items || []))
            .catch(() => {}),
          fetch("/api/instagram/media")
            .then((r) => r.json())
            .then((d) => setSavedMedia(Array.isArray(d) ? d.filter((m: IgMediaRow) => m.videoPath) : []))
            .catch(() => {}),
        ]);
        if (weekRows.length > 0) {
          setSelectedWeekId(weekRows[0].id);
          await loadFormats(weekRows[0].id);
        }
      } catch (err: unknown) {
        toast.error(err instanceof Error ? err.message : "Failed to load");
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectWeek = async (id: number) => {
    setSelectedWeekId(id);
    setLoading(true);
    try {
      await loadFormats(id);
    } finally {
      setLoading(false);
    }
  };

  const openWeekDialog = () => {
    const d = isoWeekDefaults(0);
    setWeekName(d.label);
    setWeekFrom(d.from);
    setWeekTo(d.to);
    setWeekDialogOpen(true);
  };

  const createWeek = async () => {
    const clean = weekName.trim();
    if (!clean) {
      toast.error("Name this week");
      return;
    }
    try {
      const res = await fetch("/api/format-weeks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: clean, startDate: weekFrom || null, endDate: weekTo || null }),
      });
      const row = await res.json();
      if (row.error) throw new Error(row.error);
      setWeeks((prev) => [row, ...prev]);
      setWeekDialogOpen(false);
      selectWeek(row.id);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Could not create week");
    }
  };

  const removeWeek = async (id: number) => {
    await fetch(`/api/format-weeks?id=${id}`, { method: "DELETE" });
    setWeeks((prev) => prev.filter((w) => w.id !== id));
    if (selectedWeekId === id) {
      setSelectedWeekId(null);
      setFormats([]);
    }
  };

  const addFormat = async () => {
    if (!selectedWeekId) return;
    setSaving(true);
    try {
      let row;
      if (addMode === "upload") {
        return; // handled by the file input's own onChange (addFormatFromFile)
      } else if (addMode === "existing") {
        if (!addMediaId) {
          toast.error("Pick a saved clip");
          return;
        }
        const res = await fetch("/api/winning-formats", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            mediaId: Number(addMediaId),
            title: addTitle.trim(),
            weekId: selectedWeekId,
          }),
        });
        row = await res.json();
      } else {
        if (!addUrl.trim()) {
          toast.error("Paste an Instagram link");
          return;
        }
        const res = await fetch("/api/winning-formats", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            url: addUrl.trim(),
            title: addTitle.trim(),
            weekId: selectedWeekId,
          }),
        });
        row = await res.json();
      }
      if (row.error) throw new Error(row.error);
      setFormats((prev) => [row, ...prev]);
      setAddTitle("");
      setAddUrl("");
      setAddMediaId("");
      setAdding(false);
      toast.success("Format added");
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Could not add format");
    } finally {
      setSaving(false);
    }
  };

  const addFormatFromFile = async (file: File) => {
    if (!selectedWeekId) return;
    setSaving(true);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("title", addTitle.trim() || file.name);
      form.append("weekId", String(selectedWeekId));
      const res = await fetch("/api/winning-formats", { method: "POST", body: form });
      const row = await res.json();
      if (row.error) throw new Error(row.error);
      setFormats((prev) => [row, ...prev]);
      setAddTitle("");
      setAdding(false);
      toast.success("Format added");
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setSaving(false);
    }
  };

  const removeFormat = async (id: number) => {
    await fetch(`/api/winning-formats?id=${id}`, { method: "DELETE" });
    setFormats((prev) => prev.filter((f) => f.id !== id));
  };

  const attachMethod = async (formatId: number, higgsfieldId: string) => {
    try {
      const res = await fetch("/api/winning-formats", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: formatId, methodGenerationId: higgsfieldId }),
      });
      const row = await res.json();
      if (row.error) throw new Error(row.error);
      setFormats((prev) =>
        prev.map((f) => (f.id === formatId ? { ...f, methodGenerationId: higgsfieldId } : f))
      );
      setMethodPickerFor(null);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Could not attach method");
    }
  };

  const detachMethod = async (formatId: number) => {
    await fetch("/api/winning-formats", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: formatId, methodGenerationId: null }),
    });
    setFormats((prev) =>
      prev.map((f) => (f.id === formatId ? { ...f, methodGenerationId: null } : f))
    );
  };

  const addAssignment = async (formatId: number) => {
    if (!assignModel.trim()) return;
    try {
      const res = await fetch("/api/format-assignments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          formatId,
          model: assignModel.trim(),
          quota: Number(assignQuota) || 1,
        }),
      });
      const row = await res.json();
      if (row.error) throw new Error(row.error);
      setFormats((prev) =>
        prev.map((f) =>
          f.id === formatId ? { ...f, assignments: [...f.assignments, row] } : f
        )
      );
      setAssignFor(null);
      setAssignModel("");
      setAssignQuota("1");
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Could not add assignment");
    }
  };

  const removeAssignment = async (formatId: number, assignmentId: number) => {
    await fetch(`/api/format-assignments?id=${assignmentId}`, { method: "DELETE" });
    setFormats((prev) =>
      prev.map((f) =>
        f.id === formatId
          ? { ...f, assignments: f.assignments.filter((a) => a.id !== assignmentId) }
          : f
      )
    );
  };

  const toggleComments = async (formatId: number) => {
    if (openComments === formatId) {
      setOpenComments(null);
      return;
    }
    setOpenComments(formatId);
    if (!comments[formatId]) {
      try {
        const res = await fetch(`/api/format-comments?formatId=${formatId}`);
        const rows = await res.json();
        setComments((prev) => ({ ...prev, [formatId]: Array.isArray(rows) ? rows : [] }));
      } catch {
        setComments((prev) => ({ ...prev, [formatId]: [] }));
      }
    }
  };

  const postComment = async (formatId: number) => {
    const body = commentDraft.trim();
    if (!body) return;
    setPostingComment(true);
    try {
      const res = await fetch("/api/format-comments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ formatId, body }),
      });
      const row = await res.json();
      if (row.error) throw new Error(row.error);
      setComments((prev) => ({
        ...prev,
        [formatId]: [...(prev[formatId] || []), row],
      }));
      setCommentDraft("");
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Comment failed");
    } finally {
      setPostingComment(false);
    }
  };

  return (
    <div className="flex h-screen pt-20">
      {/* Weeks */}
      <div className="w-56 shrink-0 border-r border-white/10 overflow-y-auto p-3 space-y-2">
        <h2 className="text-sm font-semibold px-1 pb-2">Formats</h2>
        <Button
          size="sm"
          variant="outline"
          onClick={openWeekDialog}
          className="w-full h-8 text-xs border-white/10 gap-1.5"
        >
          <CalendarDays className="h-3.5 w-3.5" /> New week
        </Button>
        <div className="space-y-1 pt-1">
          {weeks.map((w) => (
            <div
              key={w.id}
              className={cn(
                "group flex items-center gap-1 rounded-lg",
                selectedWeekId === w.id
                  ? "bg-[oklch(0.75_0.15_270_/_15%)]"
                  : "hover:bg-white/5"
              )}
            >
              <button
                onClick={() => selectWeek(w.id)}
                className="flex-1 text-left px-3 py-1.5"
              >
                <div className="text-xs font-medium">{w.label}</div>
                {w.startDate && (
                  <div className="text-[10px] text-muted-foreground">
                    {formatDateRange(w.startDate, w.endDate)}
                  </div>
                )}
              </button>
              <button
                onClick={() => removeWeek(w.id)}
                className="opacity-0 group-hover:opacity-100 pr-2 text-muted-foreground hover:text-red-400"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      </div>

      <Dialog open={weekDialogOpen} onOpenChange={setWeekDialogOpen}>
        <DialogContent className="glass-strong border-white/10 sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>New week</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 pt-2">
            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground">Name</label>
              <Input
                value={weekName}
                onChange={(e) => setWeekName(e.target.value)}
                placeholder="Week 37"
                className="glass border-white/10 h-9 text-sm"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1.5">
                <label className="text-xs text-muted-foreground">From</label>
                <input
                  type="date"
                  value={weekFrom}
                  onChange={(e) => setWeekFrom(e.target.value)}
                  className="w-full glass border border-white/10 rounded-md h-9 px-2 text-sm bg-transparent"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs text-muted-foreground">To</label>
                <input
                  type="date"
                  value={weekTo}
                  onChange={(e) => setWeekTo(e.target.value)}
                  min={weekFrom || undefined}
                  className="w-full glass border border-white/10 rounded-md h-9 px-2 text-sm bg-transparent"
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button
              onClick={createWeek}
              className="rounded-xl bg-[oklch(0.75_0.15_270)] hover:bg-[oklch(0.7_0.15_270)] text-white"
            >
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Formats for the selected week */}
      <div className="flex-1 overflow-y-auto p-6 space-y-4">
        {!selectedWeekId ? (
          <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
            Create a week to start dropping formats into it.
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold">
                {weeks.find((w) => w.id === selectedWeekId)?.label}
              </h3>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setAdding((v) => !v)}
                className="rounded-xl border-white/10 gap-1.5 text-xs"
              >
                {adding ? <X className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
                {adding ? "Cancel" : "Add format"}
              </Button>
            </div>

            {adding && (
              <div className="space-y-3 p-4 rounded-xl glass">
                <Input
                  value={addTitle}
                  onChange={(e) => setAddTitle(e.target.value)}
                  placeholder="Name this format"
                  className="glass border-white/10 h-8 text-xs"
                />
                <div className="glass rounded-xl p-1 flex gap-1">
                  {(["existing", "link", "upload"] as AddMode[]).map((m) => (
                    <button
                      key={m}
                      onClick={() => setAddMode(m)}
                      className={cn(
                        "flex-1 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors",
                        addMode === m
                          ? "bg-white/10 text-foreground"
                          : "text-muted-foreground hover:text-foreground"
                      )}
                    >
                      {m === "existing" ? "Saved clip" : m === "link" ? "Instagram link" : "Upload"}
                    </button>
                  ))}
                </div>

                {addMode === "existing" && (
                  savedMedia.length === 0 ? (
                    <p className="text-xs text-muted-foreground">
                      No saved clips with a downloaded video yet — save one from the
                      Instagram page first.
                    </p>
                  ) : (
                    <div className="grid grid-cols-5 sm:grid-cols-6 gap-2 max-h-56 overflow-y-auto p-1">
                      {savedMedia.map((m) => {
                        const isSelected = addMediaId === String(m.id);
                        return (
                          <button
                            key={m.id}
                            type="button"
                            onClick={() => setAddMediaId(String(m.id))}
                            title={m.caption || m.shortcode}
                            className={cn(
                              "relative aspect-[9/16] rounded-lg overflow-hidden border-2 bg-white/5 transition-colors",
                              isSelected
                                ? "border-[oklch(0.75_0.15_270)]"
                                : "border-transparent hover:border-white/20"
                            )}
                          >
                            {m.thumbPath ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                src={fileUrl(m.thumbPath)}
                                alt=""
                                className="w-full h-full object-cover"
                              />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center">
                                <Clapperboard className="h-4 w-4 text-muted-foreground" />
                              </div>
                            )}
                            {isSelected && (
                              <div className="absolute inset-0 bg-black/30 flex items-center justify-center">
                                <CheckCircle2 className="h-5 w-5 text-[oklch(0.85_0.12_270)]" />
                              </div>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  )
                )}

                {addMode === "link" && (
                  <div className="flex gap-2">
                    <Input
                      value={addUrl}
                      onChange={(e) => setAddUrl(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && addFormat()}
                      placeholder="https://www.instagram.com/reel/..."
                      className="glass border-white/10 h-8 text-xs flex-1"
                    />
                  </div>
                )}

                {addMode === "upload" ? (
                  <label className="inline-flex">
                    <input
                      type="file"
                      accept="video/*"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) addFormatFromFile(f);
                        e.target.value = "";
                      }}
                    />
                    <span
                      className={cn(
                        "inline-flex items-center gap-1.5 h-8 px-3 rounded-xl border border-white/10 text-xs cursor-pointer hover:bg-white/5",
                        saving && "pointer-events-none opacity-50"
                      )}
                    >
                      {saving ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Upload className="h-3.5 w-3.5" />
                      )}
                      Upload video
                    </span>
                  </label>
                ) : (
                  <Button
                    size="sm"
                    onClick={addFormat}
                    disabled={saving}
                    className="rounded-xl bg-[oklch(0.75_0.15_270)] hover:bg-[oklch(0.7_0.15_270)] text-white gap-1.5 text-xs"
                  >
                    {saving ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : addMode === "link" ? (
                      <LinkIcon className="h-3.5 w-3.5" />
                    ) : (
                      <Plus className="h-3.5 w-3.5" />
                    )}
                    Add
                  </Button>
                )}
              </div>
            )}

            {loading ? (
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-64 rounded-xl" />
                ))}
              </div>
            ) : formats.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Nothing dropped for this week yet.
              </p>
            ) : (
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                {formats.map((f) => {
                  const method = savedGens.find((g) => g.higgsfieldId === f.methodGenerationId);
                  return (
                    <div key={f.id} className="glass rounded-xl p-3 space-y-2 group relative">
                      <button
                        onClick={() => removeFormat(f.id)}
                        className="absolute top-2 right-2 z-10 h-6 w-6 rounded-md bg-black/60 hover:bg-red-500/50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                        title="Remove"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>

                      {f.videoPath ? (
                        <video
                          src={fileUrl(f.videoPath)}
                          poster={f.thumbPath ? fileUrl(f.thumbPath) : undefined}
                          controls
                          playsInline
                          preload="none"
                          className="w-full aspect-[9/16] rounded-lg object-cover bg-black"
                        />
                      ) : (
                        <div className="w-full aspect-[9/16] rounded-lg bg-white/5 flex items-center justify-center">
                          <Clapperboard className="h-6 w-6 text-muted-foreground" />
                        </div>
                      )}

                      <p className="text-xs font-medium truncate" title={f.title}>
                        {f.title}
                      </p>
                      {f.sourceUrl && (
                        <a
                          href={f.sourceUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="text-[10px] text-[oklch(0.85_0.12_270)] hover:underline inline-flex items-center gap-1"
                        >
                          <ExternalLink className="h-2.5 w-2.5" /> Instagram
                        </a>
                      )}

                      {/* Method */}
                      <div className="border-t border-white/5 pt-2">
                        {method ? (
                          <div className="flex items-center gap-1.5 text-[10px]">
                            <Sparkles className="h-3 w-3 text-[oklch(0.85_0.12_270)] shrink-0" />
                            <span className="truncate flex-1" title={method.prompt}>
                              {method.model}: {method.prompt.slice(0, 40)}
                            </span>
                            <button
                              onClick={() => detachMethod(f.id)}
                              className="text-muted-foreground hover:text-red-400"
                            >
                              <X className="h-2.5 w-2.5" />
                            </button>
                          </div>
                        ) : methodPickerFor === f.id ? (
                          <div className="space-y-1">
                            <select
                              onChange={(e) => e.target.value && attachMethod(f.id, e.target.value)}
                              className="w-full glass rounded-lg px-2 py-1 text-[10px] bg-transparent"
                              defaultValue=""
                            >
                              <option value="" className="bg-background">
                                Pick a saved generation...
                              </option>
                              {savedGens.map((g) => (
                                <option
                                  key={g.higgsfieldId}
                                  value={g.higgsfieldId}
                                  className="bg-background"
                                >
                                  {g.prompt.slice(0, 50)}
                                </option>
                              ))}
                            </select>
                          </div>
                        ) : (
                          <button
                            onClick={() => setMethodPickerFor(f.id)}
                            className="text-[10px] text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
                          >
                            <Sparkles className="h-3 w-3" /> Attach method
                          </button>
                        )}
                      </div>

                      {/* Assignments */}
                      <div className="border-t border-white/5 pt-2 space-y-1.5">
                        <div className="flex flex-wrap gap-1">
                          {f.assignments.map((a) => (
                            <Badge
                              key={a.id}
                              className="bg-white/10 text-[10px] gap-1 pr-1"
                            >
                              {a.model}: {a.quota}
                              <button
                                onClick={() => removeAssignment(f.id, a.id)}
                                className="hover:text-red-400"
                              >
                                <X className="h-2.5 w-2.5" />
                              </button>
                            </Badge>
                          ))}
                        </div>
                        {assignFor === f.id ? (
                          <div className="flex gap-1">
                            <input
                              list="model-options"
                              value={assignModel}
                              onChange={(e) => setAssignModel(e.target.value)}
                              placeholder="Model"
                              className="glass border-white/10 rounded-lg px-2 py-1 text-[10px] flex-1 min-w-0 bg-transparent"
                            />
                            <input
                              type="number"
                              min={1}
                              value={assignQuota}
                              onChange={(e) => setAssignQuota(e.target.value)}
                              className="glass border-white/10 rounded-lg px-2 py-1 text-[10px] w-12 bg-transparent"
                            />
                            <button
                              onClick={() => addAssignment(f.id)}
                              className="text-[oklch(0.85_0.12_270)] hover:opacity-80"
                            >
                              <Plus className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => setAssignFor(f.id)}
                            className="text-[10px] text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
                          >
                            <Bookmark className="h-3 w-3" /> Assign a model
                          </button>
                        )}
                      </div>

                      {/* Comments */}
                      <div className="border-t border-white/5 pt-2 space-y-1.5">
                        <button
                          onClick={() => toggleComments(f.id)}
                          className="text-[10px] text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
                        >
                          <MessageCircle className="h-3 w-3" />
                          {comments[f.id]?.length
                            ? `${comments[f.id].length} ${comments[f.id].length === 1 ? "comment" : "comments"}`
                            : "Comment"}
                        </button>
                        {openComments === f.id && (
                          <div className="space-y-1.5">
                            {(comments[f.id] || []).map((c) => (
                              <div key={c.id} className="text-[10px] p-1.5 rounded-lg bg-white/5">
                                <p className="text-muted-foreground">
                                  <strong className="text-foreground">{c.author}</strong> ·{" "}
                                  {timeAgo(c.createdAt)}
                                </p>
                                <p className="whitespace-pre-wrap">{c.body}</p>
                              </div>
                            ))}
                            <div className="flex gap-1">
                              <input
                                value={commentDraft}
                                onChange={(e) => setCommentDraft(e.target.value)}
                                onKeyDown={(e) => e.key === "Enter" && postComment(f.id)}
                                placeholder="Add a comment..."
                                className="glass border-white/10 rounded-lg px-2 py-1 text-[10px] flex-1 min-w-0 bg-transparent"
                              />
                              <button
                                onClick={() => postComment(f.id)}
                                disabled={postingComment}
                                className="text-[oklch(0.85_0.12_270)] hover:opacity-80 disabled:opacity-40"
                              >
                                <Send className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>

      <datalist id="model-options">
        {modelOptions.map((m) => (
          <option key={m} value={m} />
        ))}
      </datalist>
    </div>
  );
}
