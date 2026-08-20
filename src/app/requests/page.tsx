"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import {
  Megaphone,
  Film,
  Loader2,
  Trash2,
  CheckCircle2,
  RotateCcw,
  Clapperboard,
  Shirt,
  User,
  Play,
  ExternalLink,
  MessageCircle,
  Send,
  Trophy,
  Upload,
  Link as LinkIcon,
  Plus,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";

type Queue = "meta_ads" | "reels";
const QUEUES: { key: Queue; label: string; blurb: string }[] = [
  {
    key: "meta_ads",
    label: "Meta Ads Requests",
    blurb: "Clips queued to be recreated as paid ad creative.",
  },
  {
    key: "reels",
    label: "Instagram Reels Requests",
    blurb: "Clips queued to be recreated as organic reels.",
  },
];

interface Comment {
  id: number;
  requestId: number;
  author: string;
  body: string;
  createdAt: string;
}

interface RequestRow {
  id: number;
  mediaId: number;
  queue: Queue;
  comment: string | null;
  model: string | null;
  formatId: number | null;
  formatName: string | null;
  assignedBy: string;
  status: "open" | "done";
  createdAt: string;
  shortcode: string;
  caption: string | null;
  thumbPath: string | null;
  videoPath: string | null;
  durationSeconds: number | null;
  comments: Comment[];
  instagramUrl: string;
}

interface WinningFormat {
  id: number;
  queue: Queue;
  title: string;
  videoPath: string | null;
  thumbPath: string | null;
  sourceUrl: string | null;
  shortcode: string | null;
  notes: string | null;
  addedBy: string | null;
  createdAt: string;
}

const fileUrl = (p: string) => `/api/files/${p.replace(/\\/g, "/")}`;

// SQLite stores datetime('now') as UTC with no zone marker; without the Z the
// browser reads it as local time and everything looks hours old.
const timeAgo = (iso: string): string => {
  const then = Date.parse(iso.includes("Z") ? iso : `${iso}Z`);
  if (Number.isNaN(then)) return "";
  const s = Math.floor((Date.now() - then) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
};

export default function RequestsPage() {
  const router = useRouter();
  const [queue, setQueue] = useState<Queue>("meta_ads");
  const [rows, setRows] = useState<RequestRow[]>([]);
  const [formats, setFormats] = useState<WinningFormat[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<number | null>(null);

  // Which card is playing / has its thread open — one at a time keeps the
  // list scannable and stops five videos playing at once.
  const [playing, setPlaying] = useState<number | null>(null);
  const [openThread, setOpenThread] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  const [posting, setPosting] = useState(false);

  // Winning-formats composer
  const [adding, setAdding] = useState(false);
  const [newUrl, setNewUrl] = useState("");
  const [newTitle, setNewTitle] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const [r, f] = await Promise.all([
        fetch("/api/instagram/requests").then((x) => x.json()),
        fetch("/api/winning-formats").then((x) => x.json()),
      ]);
      setRows(Array.isArray(r) ? r : []);
      setFormats(Array.isArray(f) ? f : []);
    } catch {
      toast.error("Could not load requests");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const patch = async (id: number, body: Record<string, unknown>) => {
    setBusy(id);
    try {
      const res = await fetch("/api/instagram/requests", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, ...body }),
      });
      const row = await res.json();
      if (row.error) throw new Error(row.error);
      setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...row } : r)));
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Update failed");
    } finally {
      setBusy(null);
    }
  };

  const remove = async (id: number) => {
    if (!confirm("Delete this request and its replies?")) return;
    setBusy(id);
    try {
      await fetch(`/api/instagram/requests?id=${id}`, { method: "DELETE" });
      setRows((prev) => prev.filter((r) => r.id !== id));
    } finally {
      setBusy(null);
    }
  };

  const reply = async (requestId: number) => {
    const body = draft.trim();
    if (!body) return;
    setPosting(true);
    try {
      const res = await fetch(`/api/instagram/requests/${requestId}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body }),
      });
      const row = await res.json();
      if (row.error) throw new Error(row.error);
      setRows((prev) =>
        prev.map((r) =>
          r.id === requestId ? { ...r, comments: [...r.comments, row] } : r
        )
      );
      setDraft("");
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Reply failed");
    } finally {
      setPosting(false);
    }
  };

  // Fetch the mp4 if it isn't local yet, then play it in place.
  const watch = async (row: RequestRow) => {
    if (playing === row.id) {
      setPlaying(null);
      return;
    }
    if (row.videoPath) {
      setPlaying(row.id);
      return;
    }
    setBusy(row.id);
    try {
      const res = await fetch(`/api/instagram/media/${row.mediaId}/download`, {
        method: "POST",
      });
      const media = await res.json();
      if (media.error) throw new Error(media.error);
      if (!media.videoPath) throw new Error("Download returned no video");
      setRows((prev) =>
        prev.map((r) =>
          r.mediaId === row.mediaId
            ? {
                ...r,
                videoPath: media.videoPath,
                durationSeconds: media.durationSeconds ?? r.durationSeconds,
              }
            : r
        )
      );
      setPlaying(row.id);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Could not load video");
    } finally {
      setBusy(null);
    }
  };

  const openIn = async (
    row: RequestRow,
    target: "seedance" | "motion-capture"
  ) => {
    setBusy(row.id);
    try {
      let videoPath = row.videoPath;
      let duration = row.durationSeconds ?? 0;
      if (!videoPath) {
        const res = await fetch(`/api/instagram/media/${row.mediaId}/download`, {
          method: "POST",
        });
        const media = await res.json();
        if (media.error) throw new Error(media.error);
        if (!media.videoPath) throw new Error("Download returned no video");
        videoPath = media.videoPath;
        duration = media.durationSeconds ?? 0;
      }
      const params = new URLSearchParams({
        import: videoPath!,
        name: row.shortcode,
        duration: String(duration),
      });
      router.push(`/${target}?${params.toString()}`);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Could not open clip");
      setBusy(null);
    }
  };

  // ── Winning formats ──
  const addFormatFromUrl = async () => {
    if (!newUrl.trim()) return;
    setSaving(true);
    try {
      const res = await fetch("/api/winning-formats", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          queue,
          url: newUrl.trim(),
          title: newTitle.trim(),
        }),
      });
      const row = await res.json();
      if (row.error) throw new Error(row.error);
      setFormats((prev) => [row, ...prev]);
      setNewUrl("");
      setNewTitle("");
      setAdding(false);
      toast.success(
        row.videoPath ? "Added" : "Added — link saved, video couldn't be fetched"
      );
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Could not add");
    } finally {
      setSaving(false);
    }
  };

  const addFormatFromFile = async (file: File) => {
    setSaving(true);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("queue", queue);
      form.append("title", newTitle.trim() || file.name);
      const res = await fetch("/api/winning-formats", {
        method: "POST",
        body: form,
      });
      const row = await res.json();
      if (row.error) throw new Error(row.error);
      setFormats((prev) => [row, ...prev]);
      setNewTitle("");
      setAdding(false);
      toast.success("Added");
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

  // Open first, done at the bottom — done requests stay put until deleted.
  const visible = rows
    .filter((r) => r.queue === queue)
    .sort((a, b) =>
      a.status === b.status ? 0 : a.status === "open" ? -1 : 1
    );
  const openCount = (q: Queue) =>
    rows.filter((r) => r.queue === q && r.status === "open").length;
  const active = QUEUES.find((q) => q.key === queue)!;
  const queueFormats = formats.filter((f) => f.queue === queue);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl font-bold tracking-tight bg-gradient-to-r from-foreground to-foreground/60 bg-clip-text text-transparent">
          Requests
        </h2>
        <p className="text-sm text-muted-foreground mt-1">
          Clips assigned from the Instagram page, with who asked and what for.
        </p>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        {QUEUES.map((q) => (
          <button
            key={q.key}
            onClick={() => {
              setQueue(q.key);
              setPlaying(null);
              setOpenThread(null);
            }}
            className={cn(
              "flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium transition-all",
              queue === q.key
                ? "glass-strong text-foreground"
                : "text-muted-foreground hover:text-foreground hover:bg-white/5"
            )}
          >
            {q.key === "meta_ads" ? (
              <Megaphone className="h-4 w-4" />
            ) : (
              <Film className="h-4 w-4" />
            )}
            {q.label}
            {openCount(q.key) > 0 && (
              <Badge className="text-[10px] bg-[oklch(0.75_0.15_270_/_20%)] border-white/10">
                {openCount(q.key)}
              </Badge>
            )}
          </button>
        ))}
        <div className="flex-1" />
      </div>

      {/* ── Winning formats: the reels worth copying for this queue ── */}
      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2">
              <Trophy className="h-4 w-4 text-amber-400" />
              <span className="text-sm font-medium">
                Winning formats — {active.label.replace(" Requests", "")}
              </span>
              <span className="text-[11px] text-muted-foreground">
                the reels worth copying
              </span>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setAdding((v) => !v)}
              className="rounded-xl border-white/10 gap-1.5 text-xs"
            >
              {adding ? <X className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
              {adding ? "Cancel" : "Add"}
            </Button>
          </div>

          {adding && (
            <div className="space-y-2 p-3 rounded-xl glass">
              <Input
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder="Name it (optional)"
                className="glass border-white/10 h-8 text-xs"
              />
              <div className="flex gap-2 flex-wrap">
                <Input
                  value={newUrl}
                  onChange={(e) => setNewUrl(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && addFormatFromUrl()}
                  placeholder="https://www.instagram.com/reel/..."
                  className="glass border-white/10 h-8 text-xs flex-1 min-w-[240px]"
                />
                <Button
                  size="sm"
                  onClick={addFormatFromUrl}
                  disabled={saving || !newUrl.trim()}
                  className="rounded-xl bg-[oklch(0.75_0.15_270)] hover:bg-[oklch(0.7_0.15_270)] text-white gap-1.5 text-xs"
                >
                  {saving ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <LinkIcon className="h-3.5 w-3.5" />
                  )}
                  Add link
                </Button>
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
                    <Upload className="h-3.5 w-3.5" />
                    Upload video
                  </span>
                </label>
              </div>
            </div>
          )}

          {queueFormats.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              Nothing here yet — add the reels that worked so everyone can see the bar.
            </p>
          ) : (
            <div className="flex gap-3 overflow-x-auto pb-1">
              {queueFormats.map((f) => (
                <div key={f.id} className="shrink-0 w-32 group relative">
                  {f.videoPath ? (
                    <video
                      src={fileUrl(f.videoPath)}
                      poster={f.thumbPath ? fileUrl(f.thumbPath) : undefined}
                      controls
                      playsInline
                      preload="none"
                      className="w-32 aspect-[9/16] rounded-lg object-cover bg-black border border-white/10"
                    />
                  ) : (
                    <div className="w-32 aspect-[9/16] rounded-lg bg-white/5 border border-white/10 flex items-center justify-center">
                      <LinkIcon className="h-5 w-5 text-muted-foreground" />
                    </div>
                  )}
                  <p className="text-[10px] mt-1 truncate" title={f.title}>
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
                  <button
                    onClick={() => removeFormat(f.id)}
                    title="Remove"
                    className="absolute top-1 right-1 h-6 w-6 rounded-md bg-black/60 hover:bg-red-500/50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">{active.blurb}</p>

      {loading ? (
        <div className="grid gap-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-28 rounded-2xl bg-white/5" />
          ))}
        </div>
      ) : visible.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center space-y-2">
            <p className="text-sm text-muted-foreground">
              Nothing in {active.label} yet.
            </p>
            <p className="text-xs text-muted-foreground/70">
              Open the Instagram page, pick a clip, and use{" "}
              <strong>Assign to a queue</strong>.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {visible.map((r) => (
            <Card key={r.id} className={cn(r.status === "done" && "opacity-70")}>
              <CardContent className="p-3 space-y-3">
                <div className="flex gap-4">
                  {/* Poster → tap to watch the whole clip in place. */}
                  <button
                    onClick={() => watch(r)}
                    className="relative shrink-0 group"
                    title={playing === r.id ? "Hide video" : "Watch"}
                  >
                    {r.thumbPath ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={fileUrl(r.thumbPath)}
                        alt={r.shortcode}
                        className="w-20 aspect-[9/16] rounded-lg object-cover border border-white/10"
                      />
                    ) : (
                      <div className="w-20 aspect-[9/16] rounded-lg bg-white/5 border border-white/10" />
                    )}
                    <span className="absolute inset-0 flex items-center justify-center rounded-lg bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity">
                      {busy === r.id ? (
                        <Loader2 className="h-5 w-5 animate-spin" />
                      ) : (
                        <Play className="h-5 w-5" />
                      )}
                    </span>
                  </button>

                  <div className="flex-1 min-w-0 space-y-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <a
                        href={r.instagramUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="font-mono text-xs text-[oklch(0.85_0.12_270)] hover:underline inline-flex items-center gap-1"
                        title="Open the original reel on Instagram"
                      >
                        {r.shortcode}
                        <ExternalLink className="h-3 w-3" />
                      </a>
                      {r.status === "done" && (
                        <Badge className="text-[10px] bg-emerald-500/10 text-emerald-400 border-emerald-500/20 border">
                          done
                        </Badge>
                      )}
                      {r.model && (
                        <Badge className="text-[10px] bg-white/5 border-white/10 gap-1">
                          <User className="h-2.5 w-2.5" />
                          {r.model}
                        </Badge>
                      )}
                      {r.formatName && (
                        <Badge className="text-[10px] bg-white/5 border-white/10 gap-1">
                          <Shirt className="h-2.5 w-2.5" />
                          {r.formatName}
                        </Badge>
                      )}
                    </div>

                    {r.comment ? (
                      <p className="text-sm whitespace-pre-wrap">{r.comment}</p>
                    ) : (
                      <p className="text-sm text-muted-foreground/60 italic">
                        No comment
                      </p>
                    )}

                    <div className="flex items-center gap-3 flex-wrap">
                      <p className="text-[11px] text-muted-foreground">
                        assigned by <strong>{r.assignedBy}</strong> ·{" "}
                        {timeAgo(r.createdAt)}
                      </p>
                      <button
                        onClick={() =>
                          setOpenThread(openThread === r.id ? null : r.id)
                        }
                        className="text-[11px] text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
                      >
                        <MessageCircle className="h-3 w-3" />
                        {r.comments.length > 0
                          ? `${r.comments.length} ${r.comments.length === 1 ? "reply" : "replies"}`
                          : "Reply"}
                      </button>
                    </div>
                  </div>

                  <div className="flex flex-col gap-1.5 shrink-0">
                    <Button
                      size="sm"
                      onClick={() => openIn(r, "seedance")}
                      disabled={busy === r.id}
                      className="rounded-xl bg-[oklch(0.75_0.15_270)] hover:bg-[oklch(0.7_0.15_270)] text-white gap-1.5 text-xs"
                    >
                      <Shirt className="h-3.5 w-3.5" />
                      Seedance
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => openIn(r, "motion-capture")}
                      disabled={busy === r.id}
                      className="rounded-xl border-white/10 gap-1.5 text-xs"
                    >
                      <Clapperboard className="h-3.5 w-3.5" />
                      Motion
                    </Button>
                    <div className="flex gap-1">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          patch(r.id, {
                            status: r.status === "done" ? "open" : "done",
                          })
                        }
                        disabled={busy === r.id}
                        title={r.status === "done" ? "Reopen" : "Mark done"}
                        className="rounded-xl border-white/10 px-2 flex-1"
                      >
                        {r.status === "done" ? (
                          <RotateCcw className="h-3.5 w-3.5" />
                        ) : (
                          <CheckCircle2 className="h-3.5 w-3.5" />
                        )}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => remove(r.id)}
                        disabled={busy === r.id}
                        title="Delete request"
                        className="rounded-xl border-white/10 px-2 hover:bg-red-500/20"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                </div>

                {playing === r.id && r.videoPath && (
                  <video
                    src={fileUrl(r.videoPath)}
                    poster={r.thumbPath ? fileUrl(r.thumbPath) : undefined}
                    controls
                    autoPlay
                    loop
                    playsInline
                    className="w-full max-w-[280px] aspect-[9/16] rounded-xl bg-black border border-white/10 mx-auto"
                  />
                )}

                {openThread === r.id && (
                  <div className="space-y-2 pt-1 border-t border-white/5">
                    {r.comments.map((c) => (
                      <div key={c.id} className="text-sm p-2 rounded-lg glass">
                        <p className="text-[11px] text-muted-foreground mb-0.5">
                          <strong className="text-foreground">{c.author}</strong> ·{" "}
                          {timeAgo(c.createdAt)}
                        </p>
                        <p className="whitespace-pre-wrap">{c.body}</p>
                      </div>
                    ))}
                    <div className="flex gap-2 items-end">
                      <Textarea
                        value={openThread === r.id ? draft : ""}
                        onChange={(e) => setDraft(e.target.value)}
                        rows={2}
                        placeholder={`Reply to ${r.assignedBy}…`}
                        className="glass border-white/10 resize-none text-sm flex-1"
                      />
                      <Button
                        size="sm"
                        onClick={() => reply(r.id)}
                        disabled={posting || !draft.trim()}
                        className="rounded-xl bg-[oklch(0.75_0.15_270)] hover:bg-[oklch(0.7_0.15_270)] text-white gap-1.5 text-xs"
                      >
                        {posting ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Send className="h-3.5 w-3.5" />
                        )}
                        Send
                      </Button>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
