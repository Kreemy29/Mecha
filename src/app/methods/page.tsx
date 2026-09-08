"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { Bookmark, BookmarkCheck, Copy, Loader2, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";

interface GenerationMediaRef {
  role: string;
  url: string;
  type?: string;
}

// Normalized shape both the live Higgsfield browse and the locally-saved
// subset render into, so the detail panel doesn't care which scope it came
// from.
interface DisplayGeneration {
  id: string;
  type: string;
  status: string;
  model: string;
  prompt: string;
  params: Record<string, unknown>;
  medias: GenerationMediaRef[];
  outputUrl: string | null;
  thumbnailUrl: string | null;
  createdAt: number | null;
  saved: boolean;
}

const fileUrl = (p: string) => `/api/files/${p.replace(/\\/g, "/")}`;

function timeAgo(unixSeconds: number | null): string {
  if (!unixSeconds) return "";
  const diffMs = Date.now() - unixSeconds * 1000;
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

// Every field in a generation's params besides the prompt and its reference
// medias — shown as raw settings since each model has a different shape.
function settingsOf(params: Record<string, unknown>): Record<string, unknown> {
  const { prompt: _prompt, medias: _medias, ...rest } = params;
  return rest;
}

type Scope = "all" | "saved";

export default function MethodsPage() {
  const [scope, setScope] = useState<Scope>("all");

  // Live Higgsfield browse (scope "all")
  const [items, setItems] = useState<DisplayGeneration[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  // Locally saved subset (scope "saved")
  const [savedItems, setSavedItems] = useState<DisplayGeneration[]>([]);
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());

  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<DisplayGeneration | null>(null);
  const [saving, setSaving] = useState(false);

  const loadSaved = useCallback(async (): Promise<DisplayGeneration[]> => {
    const res = await fetch("/api/higgsfield/generations/saved");
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    const mapped: DisplayGeneration[] = data.items.map(
      (s: {
        higgsfieldId: string;
        type: string;
        status: string;
        model: string;
        prompt: string;
        params: Record<string, unknown>;
        medias: GenerationMediaRef[];
        outputPath: string | null;
        thumbnailPath: string | null;
        generatedAt: number | null;
      }) => ({
        id: s.higgsfieldId,
        type: s.type,
        status: s.status,
        model: s.model,
        prompt: s.prompt,
        params: s.params,
        medias: s.medias,
        outputUrl: s.outputPath ? fileUrl(s.outputPath) : null,
        thumbnailUrl: s.thumbnailPath ? fileUrl(s.thumbnailPath) : null,
        createdAt: s.generatedAt,
        saved: true,
      })
    );
    return mapped;
  }, []);

  const loadAll = useCallback(async (cursor?: string) => {
    const url = cursor
      ? `/api/higgsfield/generations?cursor=${encodeURIComponent(cursor)}`
      : "/api/higgsfield/generations";
    const res = await fetch(url);
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    return data as {
      items: Omit<DisplayGeneration, "saved">[];
      nextCursor: string | null;
    };
  }, []);

  // savedIds is used to badge the "all" list — keep it fresh whenever the
  // saved set could have changed.
  const refreshSavedIds = useCallback(async () => {
    try {
      const saved = await loadSaved();
      setSavedIds(new Set(saved.map((s) => s.id)));
      return saved;
    } catch {
      return [];
    }
  }, [loadSaved]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const saved = await refreshSavedIds();
        const page = await loadAll();
        const withSaved = page.items.map((g) => ({
          ...g,
          saved: new Set(saved.map((s) => s.id)).has(g.id),
        }));
        setItems(withSaved);
        setNextCursor(page.nextCursor);
        setSelected(withSaved[0] || null);
      } catch (err: unknown) {
        toast.error(err instanceof Error ? err.message : "Failed to load generations");
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const switchScope = async (next: Scope) => {
    setScope(next);
    setSelected(null);
    if (next === "saved") {
      setLoading(true);
      try {
        const saved = await refreshSavedIds();
        setSavedItems(saved);
        setSelected(saved[0] || null);
      } catch (err: unknown) {
        toast.error(err instanceof Error ? err.message : "Failed to load saved");
      } finally {
        setLoading(false);
      }
    } else {
      setSelected(items[0] || null);
    }
  };

  const loadMore = async () => {
    if (!nextCursor) return;
    setLoadingMore(true);
    try {
      const page = await loadAll(nextCursor);
      const withSaved = page.items.map((g) => ({ ...g, saved: savedIds.has(g.id) }));
      setItems((prev) => [...prev, ...withSaved]);
      setNextCursor(page.nextCursor);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to load more");
    } finally {
      setLoadingMore(false);
    }
  };

  const refresh = async () => {
    setLoading(true);
    try {
      if (scope === "saved") {
        const saved = await refreshSavedIds();
        setSavedItems(saved);
        setSelected(saved[0] || null);
      } else {
        const saved = await refreshSavedIds();
        const page = await loadAll();
        const withSaved = page.items.map((g) => ({
          ...g,
          saved: new Set(saved.map((s) => s.id)).has(g.id),
        }));
        setItems(withSaved);
        setNextCursor(page.nextCursor);
        setSelected(withSaved[0] || null);
      }
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to refresh");
    } finally {
      setLoading(false);
    }
  };

  const copyPrompt = (prompt: string) => {
    navigator.clipboard.writeText(prompt);
    toast.success("Prompt copied");
  };

  const toggleSave = async (g: DisplayGeneration) => {
    setSaving(true);
    try {
      if (g.saved) {
        await fetch(`/api/higgsfield/generations/save?id=${encodeURIComponent(g.id)}`, {
          method: "DELETE",
        });
        toast.success("Removed from saved");
      } else {
        const res = await fetch("/api/higgsfield/generations/save", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ generation: g }),
        });
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        toast.success("Saved");
      }
      setSavedIds((prev) => {
        const next = new Set(prev);
        if (g.saved) next.delete(g.id);
        else next.add(g.id);
        return next;
      });
      setItems((prev) => prev.map((i) => (i.id === g.id ? { ...i, saved: !g.saved } : i)));
      setSelected((prev) => (prev && prev.id === g.id ? { ...prev, saved: !g.saved } : prev));
      if (scope === "saved") {
        const saved = await loadSaved();
        setSavedItems(saved);
        if (g.saved) setSelected(saved[0] || null);
      }
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const list = scope === "saved" ? savedItems : items;

  return (
    <div className="flex h-screen pt-20">
      {/* List */}
      <div className="w-80 shrink-0 border-r border-white/10 overflow-y-auto p-3 space-y-2">
        <div className="flex items-center justify-between px-1 pb-2">
          <h2 className="text-sm font-semibold">Methods</h2>
          <Button variant="ghost" size="sm" onClick={refresh} className="h-7 px-2">
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
        </div>

        <div className="glass rounded-xl p-1 flex gap-1 mb-2">
          <button
            onClick={() => switchScope("all")}
            className={cn(
              "flex-1 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors",
              scope === "all"
                ? "bg-[oklch(0.75_0.15_270_/_15%)] text-[oklch(0.85_0.12_270)]"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            All
          </button>
          <button
            onClick={() => switchScope("saved")}
            className={cn(
              "flex-1 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors",
              scope === "saved"
                ? "bg-[oklch(0.75_0.15_270_/_15%)] text-[oklch(0.85_0.12_270)]"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            Saved{savedIds.size > 0 && ` (${savedIds.size})`}
          </button>
        </div>

        {loading ? (
          Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-16 rounded-xl" />
          ))
        ) : list.length === 0 ? (
          <div className="glass rounded-xl p-6 text-center text-sm text-muted-foreground">
            {scope === "saved" ? "Nothing saved yet." : "No generations found."}
          </div>
        ) : (
          <>
            {list.map((g) => (
              <button
                key={g.id}
                onClick={() => setSelected(g)}
                className={cn(
                  "w-full flex items-center gap-3 rounded-xl p-2 text-left transition-colors",
                  selected?.id === g.id
                    ? "bg-[oklch(0.75_0.15_270_/_15%)]"
                    : "hover:bg-white/5"
                )}
              >
                <div className="h-12 w-12 shrink-0 rounded-lg overflow-hidden bg-white/5 relative">
                  {g.thumbnailUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={g.thumbnailUrl}
                      alt=""
                      className="h-full w-full object-cover"
                    />
                  ) : null}
                  {g.saved && (
                    <BookmarkCheck className="absolute top-0.5 right-0.5 h-3 w-3 text-[oklch(0.85_0.12_270)] drop-shadow" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-medium truncate">{g.model}</span>
                    <Badge
                      className={cn(
                        "h-4 px-1.5 text-[10px] shrink-0",
                        g.status === "completed"
                          ? "bg-emerald-500/15 text-emerald-400"
                          : g.status === "error" || g.status === "failed"
                            ? "bg-red-500/15 text-red-400"
                            : "bg-white/10 text-muted-foreground"
                      )}
                    >
                      {g.status}
                    </Badge>
                  </div>
                  <p className="text-[11px] text-muted-foreground truncate">
                    {g.prompt || g.type}
                  </p>
                  <p className="text-[10px] text-muted-foreground">{timeAgo(g.createdAt)}</p>
                </div>
              </button>
            ))}
            {scope === "all" && nextCursor && (
              <Button
                variant="outline"
                size="sm"
                className="w-full mt-2"
                onClick={loadMore}
                disabled={loadingMore}
              >
                {loadingMore ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Load more"}
              </Button>
            )}
          </>
        )}
      </div>

      {/* Detail */}
      <div className="flex-1 overflow-y-auto p-6">
        {!selected ? (
          <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
            Select a generation to view its prompt, settings, and output.
          </div>
        ) : (
          <div className="max-w-3xl mx-auto space-y-6">
            <div className="flex items-center gap-2">
              <Badge className="bg-white/10">{selected.model}</Badge>
              <Badge
                className={cn(
                  selected.status === "completed"
                    ? "bg-emerald-500/15 text-emerald-400"
                    : selected.status === "error" || selected.status === "failed"
                      ? "bg-red-500/15 text-red-400"
                      : "bg-white/10 text-muted-foreground"
                )}
              >
                {selected.status}
              </Badge>
              <span className="text-xs text-muted-foreground">{timeAgo(selected.createdAt)}</span>
              <div className="flex-1" />
              <Button
                variant={selected.saved ? "outline" : "default"}
                size="sm"
                className="h-7 px-2 text-xs"
                onClick={() => toggleSave(selected)}
                disabled={saving}
              >
                {saving ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
                ) : selected.saved ? (
                  <BookmarkCheck className="h-3.5 w-3.5 mr-1.5" />
                ) : (
                  <Bookmark className="h-3.5 w-3.5 mr-1.5" />
                )}
                {selected.saved ? "Saved" : "Save"}
              </Button>
            </div>

            {selected.outputUrl ? (
              selected.type === "video" ? (
                <video
                  src={selected.outputUrl}
                  poster={selected.thumbnailUrl || undefined}
                  controls
                  className="w-full max-h-[60vh] rounded-2xl bg-black"
                />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={selected.outputUrl}
                  alt=""
                  className="w-full max-h-[60vh] rounded-2xl object-contain bg-black"
                />
              )
            ) : (
              <div className="glass rounded-2xl p-8 text-center text-sm text-muted-foreground">
                No output for this generation.
              </div>
            )}

            {selected.medias.length > 0 && (
              <div>
                <h3 className="text-xs font-semibold text-muted-foreground mb-2">
                  References
                </h3>
                <div className="flex gap-2 flex-wrap">
                  {selected.medias.map((m, i) => (
                    <div
                      key={i}
                      className="h-16 w-16 rounded-lg overflow-hidden bg-white/5 relative"
                      title={m.role}
                    >
                      {m.type === "video_input" ? (
                        <video src={m.url} className="h-full w-full object-cover" />
                      ) : (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={m.url} alt={m.role} className="h-full w-full object-cover" />
                      )}
                      <span className="absolute bottom-0 inset-x-0 bg-black/60 text-[9px] text-center py-0.5">
                        {m.role}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div>
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-xs font-semibold text-muted-foreground">Prompt</h3>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2 text-xs"
                  onClick={() => copyPrompt(selected.prompt)}
                >
                  <Copy className="h-3 w-3 mr-1" /> Copy
                </Button>
              </div>
              <pre className="glass rounded-xl p-4 text-xs whitespace-pre-wrap break-words max-h-64 overflow-y-auto">
                {selected.prompt || "(no prompt)"}
              </pre>
            </div>

            <div>
              <h3 className="text-xs font-semibold text-muted-foreground mb-2">Settings</h3>
              <pre className="glass rounded-xl p-4 text-xs whitespace-pre-wrap break-words max-h-64 overflow-y-auto">
                {JSON.stringify(settingsOf(selected.params), null, 2)}
              </pre>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
