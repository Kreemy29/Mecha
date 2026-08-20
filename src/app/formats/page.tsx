"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import {
  LayoutGrid,
  ArrowLeft,
  Sparkles,
  Loader2,
  Shirt,
  Scissors,
  Brush,
  ImagePlus,
  Users,
  Trash2,
  Download,
  X,
  Star,
  Plus,
  Film,
  Bookmark,
} from "lucide-react";
import { applyOverrides, usefulCharacterProfile } from "@/lib/prompt-overrides";
import { cn } from "@/lib/utils";

// A saved "format": a proven recreation prompt plus the frame it came from.
// Everything that makes the shot work (pose, camera, lighting, composition) is
// frozen; the character and the styling are swapped per generation.
interface Format {
  id: number;
  name: string;
  prompt: string;
  thumbPath: string | null;
  videoPath: string | null;
  durationSeconds: number | null;
  notes: string | null;
}

interface Character {
  id: number;
  name: string;
  featureProfile: string;
  baseImagePath: string | null;
}

interface StylePreset {
  id: number;
  kind: "hair" | "makeup" | "outfit";
  name: string;
  description: string;
  isDefault: boolean;
}

interface SavedBackground {
  id: number;
  name: string;
  description: string;
  imagePath: string | null;
}

interface Job {
  id: number;
  status: string;
  outputPath: string | null;
  error: string | null;
}

// One queued render: which outfit it was for, and the job behind it.
interface Render {
  id: string;
  outfit: string;
  job: Job;
}

const fileUrl = (p: string) =>
  p.startsWith("http") ? p : `/api/files/${p.replace(/\\/g, "/")}`;
const uid = () => `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
const isActive = (s: string) => ["queued", "running", "polling"].includes(s);

const statusColor: Record<string, string> = {
  queued: "bg-amber-500/10 text-amber-400 border-amber-500/20",
  running: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  polling: "bg-cyan-500/10 text-cyan-400 border-cyan-500/20",
  succeeded: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  failed: "bg-red-500/10 text-red-400 border-red-500/20",
  filtered: "bg-orange-500/10 text-orange-400 border-orange-500/20",
  rejected: "bg-violet-500/10 text-violet-400 border-violet-500/20",
};

const ASPECTS = ["3:4", "9:16", "1:1", "16:9"];

export default function FormatsPage() {
  const [formats, setFormats] = useState<Format[]>([]);
  const [characters, setCharacters] = useState<Character[]>([]);
  const [styles, setStyles] = useState<StylePreset[]>([]);
  const [backgrounds, setBackgrounds] = useState<SavedBackground[]>([]);
  const [loading, setLoading] = useState(true);

  // Detail view — null means we're on the grid.
  const [open, setOpen] = useState<Format | null>(null);

  // Generation controls
  const [character, setCharacter] = useState<Character | null>(null);
  const [outfits, setOutfits] = useState<string[]>([]);
  const [newOutfit, setNewOutfit] = useState("");
  const [hair, setHair] = useState("");
  const [makeup, setMakeup] = useState("");
  const [bgId, setBgId] = useState<number | null>(null);
  const [aspect, setAspect] = useState("3:4");
  const [generating, setGenerating] = useState(false);
  const [renders, setRenders] = useState<Render[]>([]);

  // ── New-format form ──
  // A format can be banked straight from a reference shot here, not only from
  // a finished Seedance still: upload the image, let Grok write the recreation
  // prompt from it (or paste one you already trust), save.
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newThumb, setNewThumb] = useState<{ path: string; url: string } | null>(
    null
  );
  const [newVideo, setNewVideo] = useState<{
    path: string;
    duration: number;
  } | null>(null);
  const [newPrompt, setNewPrompt] = useState("");
  const [promptChar, setPromptChar] = useState<Character | null>(null);
  const [uploading, setUploading] = useState<"image" | "video" | null>(null);
  const [writing, setWriting] = useState(false);
  const [saving, setSaving] = useState(false);
  const imgInputRef = useRef<HTMLInputElement>(null);
  const vidInputRef = useRef<HTMLInputElement>(null);

  // Kept in sync so the single poller below never reads stale renders.
  const rendersRef = useRef<Render[]>(renders);
  useEffect(() => {
    rendersRef.current = renders;
  }, [renders]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [f, c, s, b] = await Promise.all([
        fetch("/api/prompt-presets"),
        fetch("/api/characters"),
        fetch("/api/style-presets"),
        fetch("/api/backgrounds"),
      ]);
      setFormats(await f.json());
      setCharacters(await c.json());
      const st: StylePreset[] = await s.json();
      setStyles(st);
      setBackgrounds(await b.json());

      // Defaults preselect, exactly like the Seedance style step.
      const dh = st.find((x) => x.kind === "hair" && x.isDefault);
      const dm = st.find((x) => x.kind === "makeup" && x.isDefault);
      if (dh) setHair(dh.description);
      if (dm) setMakeup(dm.description);
    } catch {
      toast.error("Failed to load formats");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Single poller for everything queued from this page.
  useEffect(() => {
    const interval = setInterval(async () => {
      if (!rendersRef.current.some((r) => isActive(r.job.status))) return;
      try {
        const res = await fetch("/api/jobs?limit=200");
        const all: Job[] = await res.json();
        const byId = new Map(all.map((j) => [j.id, j]));
        setRenders((prev) =>
          prev.map((r) => ({ ...r, job: byId.get(r.job.id) || r.job }))
        );
      } catch {
        // silent — next tick retries
      }
    }, 2500);
    return () => clearInterval(interval);
  }, []);

  const openFormat = (f: Format) => {
    setOpen(f);
    setRenders([]);
    setOutfits([]);
    setNewOutfit("");
  };

  const addOutfit = () => {
    const t = newOutfit.trim();
    if (!t) return;
    setOutfits((prev) => [...prev, t]);
    setNewOutfit("");
  };

  // Saved outfit library — shared with the Seedance outfits step.
  const savedOutfits = styles.filter((s) => s.kind === "outfit");

  const saveOutfitPreset = async (description: string) => {
    const name = window.prompt("Name this outfit:", description.slice(0, 40));
    if (!name?.trim()) return;
    try {
      const res = await fetch("/api/style-presets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "outfit", name, description }),
      });
      const row = await res.json();
      if (row.error) throw new Error(row.error);
      setStyles((prev) => [row, ...prev]);
      toast.success(`Saved outfit "${row.name}"`);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to save outfit");
    }
  };

  const deleteFormat = async (f: Format) => {
    if (!window.confirm(`Delete the format "${f.name}"? This can't be undone.`)) {
      return;
    }
    await fetch(`/api/prompt-presets?id=${f.id}`, { method: "DELETE" });
    setFormats((prev) => prev.filter((x) => x.id !== f.id));
    if (open?.id === f.id) setOpen(null);
    toast.success(`Deleted "${f.name}"`);
  };

  // ── Creating a format from scratch ──
  const resetForm = () => {
    setCreating(false);
    setNewName("");
    setNewThumb(null);
    setNewVideo(null);
    setNewPrompt("");
    setPromptChar(null);
  };

  const uploadThumb = async (file: File) => {
    setUploading("image");
    try {
      const form = new FormData();
      form.append("files", file);
      const res = await fetch("/api/references/upload", {
        method: "POST",
        body: form,
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      const first = data.results?.[0];
      if (!first) throw new Error("Upload returned nothing");
      setNewThumb({ path: first.path, url: first.imageUrl });
      if (!newName.trim()) setNewName(file.name.replace(/\.[^.]+$/, ""));
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Image upload failed");
    } finally {
      setUploading(null);
    }
  };

  // Optional — only needed if the format should also drive a Seedance video.
  const uploadVideo = async (file: File) => {
    setUploading("video");
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/references/video", {
        method: "POST",
        body: form,
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setNewVideo({
        path: data.videoPath,
        duration: data.durationSeconds || 0,
      });
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Video upload failed");
    } finally {
      setUploading(null);
    }
  };

  // Have Grok reverse-engineer the reference shot into a recreation prompt —
  // the same call the Seedance stills step makes. The character only seeds the
  // identity fields; they get re-pointed on every future use anyway.
  const writePrompt = async () => {
    if (!newThumb || !promptChar?.baseImagePath) return;
    setWriting(true);
    try {
      const origin = window.location.origin;
      const faceRefUrl = promptChar.baseImagePath.startsWith("http")
        ? promptChar.baseImagePath
        : `${origin}${fileUrl(promptChar.baseImagePath)}`;
      const res = await fetch("/api/grok/swap-prompt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sceneRefUrl: newThumb.url,
          faceRefUrl,
          settingDescription:
            usefulCharacterProfile(promptChar.featureProfile) || undefined,
          characterName: promptChar.name,
        }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setNewPrompt(data.prompt);
      toast.success("Prompt written — review it, then save");
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Grok call failed");
    } finally {
      setWriting(false);
    }
  };

  const saveFormat = async () => {
    if (!newName.trim() || !newPrompt.trim()) return;
    setSaving(true);
    try {
      const res = await fetch("/api/prompt-presets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newName,
          prompt: newPrompt,
          thumbPath: newThumb?.path,
          videoPath: newVideo?.path,
          durationSeconds: newVideo?.duration,
        }),
      });
      const row = await res.json();
      if (row.error) throw new Error(row.error);
      setFormats((prev) => [row, ...prev]);
      resetForm();
      toast.success(`Saved format "${row.name}"`);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to save format");
    } finally {
      setSaving(false);
    }
  };

  // Queue one still per outfit (or a single one keeping the format's own
  // attire when no outfit was added).
  const generate = async () => {
    if (!open || !character) return;
    setGenerating(true);
    try {
      const background = bgId
        ? backgrounds.find((b) => b.id === bgId)?.description
        : undefined;
      // The format's own frame is the pose/composition reference.
      const sceneRefUrl = open.thumbPath
        ? `${window.location.origin}${fileUrl(open.thumbPath)}`
        : undefined;

      const targets = outfits.length > 0 ? outfits : [""];
      const queued: Render[] = [];

      for (const outfit of targets) {
        const prompt = applyOverrides(open.prompt, {
          characterName: character.name,
          characterProfile: character.featureProfile,
          outfit: outfit || undefined,
          hair,
          makeup,
          background,
        });

        const res = await fetch("/api/jobs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            kind: "image",
            prompt,
            provider: "higgsfield",
            providerModel: "soul_2",
            providerParams: { quality: "2k", aspectRatio: aspect, sceneRefUrl },
            characterId: character.id,
          }),
        });
        const job = await res.json();
        if (job.error) throw new Error(job.error);
        queued.push({ id: uid(), outfit: outfit || "as saved", job });
      }

      setRenders((prev) => [...queued, ...prev]);
      toast.success(
        `Queued ${queued.length} image${queued.length === 1 ? "" : "s"} — the worker picks them up`
      );
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to queue");
    } finally {
      setGenerating(false);
    }
  };

  // ── Grid ──
  if (!open) {
    return (
      <div className="space-y-6">
        <div className="flex items-end justify-between gap-4 flex-wrap">
          <div>
            <h2 className="text-3xl font-bold tracking-tight bg-gradient-to-r from-foreground to-foreground/60 bg-clip-text text-transparent">
              Formats
            </h2>
            <p className="text-sm text-muted-foreground mt-1">
              Proven shots, ready to re-run. Pick one, choose a character, change
              the outfit and styling — everything else stays exactly as it worked.
            </p>
          </div>
          {!creating && (
            <Button
              onClick={() => setCreating(true)}
              className="rounded-xl bg-[oklch(0.75_0.15_270)] hover:bg-[oklch(0.7_0.15_270)] text-white gap-2"
            >
              <Plus className="h-4 w-4" /> New format
            </Button>
          )}
        </div>

        {/* ── New format ── */}
        {creating && (
          <Card>
            <CardContent className="pt-5 space-y-4">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium">New format</p>
                <button
                  onClick={resetForm}
                  className="text-muted-foreground hover:text-foreground"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="grid sm:grid-cols-[160px_1fr] gap-4 items-start">
                {/* Reference shot */}
                <div className="space-y-2">
                  <input
                    ref={imgInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => {
                      if (e.target.files?.[0]) uploadThumb(e.target.files[0]);
                      e.target.value = "";
                    }}
                  />
                  <button
                    onClick={() => imgInputRef.current?.click()}
                    disabled={uploading === "image"}
                    className="relative w-full aspect-[3/4] rounded-xl overflow-hidden glass border border-dashed border-white/15 hover:bg-white/5 flex items-center justify-center"
                  >
                    {newThumb ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={newThumb.url}
                        alt="reference"
                        className="absolute inset-0 h-full w-full object-cover"
                      />
                    ) : uploading === "image" ? (
                      <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                    ) : (
                      <span className="text-xs text-muted-foreground px-2 text-center">
                        Upload the shot
                      </span>
                    )}
                  </button>

                  <input
                    ref={vidInputRef}
                    type="file"
                    accept="video/*"
                    className="hidden"
                    onChange={(e) => {
                      if (e.target.files?.[0]) uploadVideo(e.target.files[0]);
                      e.target.value = "";
                    }}
                  />
                  <Button
                    onClick={() => vidInputRef.current?.click()}
                    disabled={uploading === "video"}
                    variant="outline"
                    size="sm"
                    className="w-full h-8 text-[11px] border-white/10 gap-1.5"
                  >
                    {uploading === "video" ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <Film className="h-3 w-3" />
                    )}
                    {newVideo ? `Video · ${newVideo.duration}s` : "Video (optional)"}
                  </Button>
                  <p className="text-[10px] text-muted-foreground leading-snug">
                    A video is only needed if this format should also drive a
                    Seedance clip.
                  </p>
                </div>

                <div className="space-y-3">
                  <Input
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    placeholder="Format name — e.g. Rooftop golden hour lean"
                    className="glass border-white/10"
                  />

                  {/* Write it with Grok, or paste one you already trust */}
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs text-muted-foreground">
                        Write the prompt from the shot using
                      </span>
                      {characters.slice(0, 6).map((c) => (
                        <button
                          key={c.id}
                          onClick={() => setPromptChar(c)}
                          className={cn(
                            "px-2 py-0.5 rounded text-[11px] border transition-colors",
                            promptChar?.id === c.id
                              ? "bg-[oklch(0.75_0.15_270_/_25%)] border-white/20 text-white"
                              : "bg-white/5 border-white/10 text-muted-foreground hover:text-foreground"
                          )}
                        >
                          {c.name}
                        </button>
                      ))}
                      <Button
                        onClick={writePrompt}
                        disabled={!newThumb || !promptChar || writing}
                        size="sm"
                        variant="outline"
                        className="h-7 text-[11px] border-white/10 gap-1.5"
                      >
                        {writing ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <Sparkles className="h-3 w-3" />
                        )}
                        Write with Grok
                      </Button>
                    </div>
                    <p className="text-[10px] text-muted-foreground">
                      The character here only seeds the identity fields — they
                      get re-pointed every time you use the format.
                    </p>
                  </div>

                  <Textarea
                    value={newPrompt}
                    onChange={(e) => setNewPrompt(e.target.value)}
                    rows={10}
                    placeholder="Paste a recreation prompt (JSON), or write one with Grok above."
                    className="glass border-white/10 font-mono text-[11px]"
                  />

                  <div className="flex justify-end gap-2">
                    <Button variant="ghost" onClick={resetForm} disabled={saving}>
                      Cancel
                    </Button>
                    <Button
                      onClick={saveFormat}
                      disabled={!newName.trim() || !newPrompt.trim() || saving}
                      className="rounded-xl bg-[oklch(0.75_0.15_270)] hover:bg-[oklch(0.7_0.15_270)] text-white gap-2"
                    >
                      {saving ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Plus className="h-4 w-4" />
                      )}
                      Save format
                    </Button>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {loading ? (
          <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-5 gap-1.5">
            {Array.from({ length: 10 }).map((_, i) => (
              <Skeleton key={i} className="aspect-[3/4] rounded-sm" />
            ))}
          </div>
        ) : formats.length === 0 ? (
          <Card>
            <CardContent className="py-16 text-center space-y-2">
              <LayoutGrid className="h-10 w-10 mx-auto text-muted-foreground" />
              <p className="text-sm font-medium">No formats yet</p>
              <p className="text-xs text-muted-foreground max-w-md mx-auto">
                Hit <strong>New format</strong> to bank one from a reference
                shot, or — in Seedance, once a still comes out the way you want
                — hit <strong>Save prompt</strong> on that variant. Either way it
                lands here, re-runnable on any character.
              </p>
            </CardContent>
          </Card>
        ) : (
          /* Tight uniform grid, IG-profile style */
          <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-5 gap-1.5">
            {formats.map((f) => (
              <div
                key={f.id}
                className="group relative aspect-[3/4] overflow-hidden rounded-sm bg-white/5"
              >
                <button
                  onClick={() => openFormat(f)}
                  className="absolute inset-0 h-full w-full"
                >
                  {f.thumbPath ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={fileUrl(f.thumbPath)}
                      alt={f.name}
                      loading="lazy"
                      className="absolute inset-0 h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                    />
                  ) : (
                    <div className="absolute inset-0 flex items-center justify-center text-muted-foreground">
                      <Sparkles className="h-6 w-6" />
                    </div>
                  )}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                  <p className="absolute bottom-0 inset-x-0 p-2 text-[11px] font-medium text-white text-left truncate opacity-0 group-hover:opacity-100 transition-opacity">
                    {f.name}
                  </p>
                </button>

                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    deleteFormat(f);
                  }}
                  className="absolute top-1.5 right-1.5 h-7 w-7 rounded-md bg-black/60 backdrop-blur flex items-center justify-center text-white/70 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
                  title={`Delete "${f.name}"`}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  // ── Detail: configure + generate ──
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setOpen(null)}
          className="gap-2"
        >
          <ArrowLeft className="h-4 w-4" /> Formats
        </Button>
        <h2 className="text-xl font-bold tracking-tight truncate">{open.name}</h2>
        <button
          onClick={() => deleteFormat(open)}
          className="ml-auto text-muted-foreground hover:text-red-400"
          title="Delete format"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>

      <div className="grid lg:grid-cols-[300px_1fr] gap-6 items-start">
        {/* The frozen shot */}
        <Card className="overflow-hidden">
          <div className="relative aspect-[3/4] bg-white/5">
            {open.thumbPath ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={fileUrl(open.thumbPath)}
                alt={open.name}
                className="absolute inset-0 h-full w-full object-cover"
              />
            ) : (
              <div className="absolute inset-0 flex items-center justify-center text-muted-foreground">
                <Sparkles className="h-8 w-8" />
              </div>
            )}
          </div>
          <CardContent className="pt-3 space-y-1">
            <p className="text-[11px] text-muted-foreground">
              Pose, camera, lighting and composition are locked to this shot.
            </p>
            {open.videoPath && (
              <Badge className="text-[10px] bg-white/5 border-white/10">
                video attached · {open.durationSeconds ?? "?"}s
              </Badge>
            )}
          </CardContent>
        </Card>

        {/* Controls */}
        <div className="space-y-4">
          {/* Character */}
          <Card>
            <CardContent className="pt-5 space-y-3">
              <p className="text-sm font-medium flex items-center gap-2">
                <Users className="h-4 w-4" /> Character
              </p>
              {characters.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  No characters yet — add one on the Characters page.
                </p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {characters.map((c) => (
                    <button
                      key={c.id}
                      onClick={() => setCharacter(c)}
                      className={cn(
                        "flex items-center gap-2 rounded-xl border px-2.5 py-1.5 transition-colors",
                        character?.id === c.id
                          ? "bg-[oklch(0.75_0.15_270_/_20%)] border-white/20"
                          : "glass border-white/10 hover:bg-white/5"
                      )}
                    >
                      {c.baseImagePath ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={fileUrl(c.baseImagePath)}
                          alt={c.name}
                          className="h-6 w-6 rounded-full object-cover"
                        />
                      ) : (
                        <div className="h-6 w-6 rounded-full bg-white/10" />
                      )}
                      <span className="text-xs">{c.name}</span>
                    </button>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Outfits */}
          <Card>
            <CardContent className="pt-5 space-y-3">
              <p className="text-sm font-medium flex items-center gap-2">
                <Shirt className="h-4 w-4" /> Outfits
                <span className="text-xs text-muted-foreground font-normal">
                  one image per outfit — leave empty to keep the saved one
                </span>
              </p>
              <div className="flex gap-2">
                <Input
                  value={newOutfit}
                  onChange={(e) => setNewOutfit(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && addOutfit()}
                  placeholder="e.g. white linen sundress"
                  className="glass border-white/10 h-9"
                />
                <Button
                  onClick={addOutfit}
                  disabled={!newOutfit.trim()}
                  size="sm"
                  className="h-9"
                >
                  Add
                </Button>
              </div>
              {/* Saved outfit library — click to add */}
              {savedOutfits.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {savedOutfits.map((p) => {
                    const added = outfits.includes(p.description);
                    return (
                      <button
                        key={p.id}
                        onClick={() =>
                          setOutfits((prev) =>
                            added
                              ? prev.filter((o) => o !== p.description)
                              : [...prev, p.description]
                          )
                        }
                        className={cn(
                          "px-2 py-0.5 rounded text-[11px] border transition-colors truncate max-w-[220px]",
                          added
                            ? "bg-[oklch(0.75_0.15_270_/_25%)] border-white/20 text-white"
                            : "bg-white/5 border-white/10 text-muted-foreground hover:text-foreground"
                        )}
                        title={p.description}
                      >
                        {p.name}
                      </button>
                    );
                  })}
                </div>
              )}

              {outfits.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {outfits.map((o, i) => {
                    const isSaved = savedOutfits.some(
                      (p) => p.description === o
                    );
                    return (
                      <span
                        key={i}
                        className="flex items-center gap-1.5 rounded-lg bg-[oklch(0.75_0.15_270_/_20%)] border border-white/20 px-2 py-1 text-xs"
                      >
                        <span className="truncate max-w-[200px]">{o}</span>
                        {!isSaved && (
                          <button
                            onClick={() => saveOutfitPreset(o)}
                            title="Save to your outfit library"
                            className="text-white/60 hover:text-white"
                          >
                            <Bookmark className="h-3 w-3" />
                          </button>
                        )}
                        <button
                          onClick={() =>
                            setOutfits((prev) => prev.filter((_, j) => j !== i))
                          }
                          title="Remove"
                          className="text-white/60 hover:text-white"
                        >
                          <X className="h-3 w-3 shrink-0" />
                        </button>
                      </span>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Hair + makeup */}
          <div className="grid sm:grid-cols-2 gap-4">
            {(["hair", "makeup"] as const).map((kind) => {
              const Icon = kind === "hair" ? Scissors : Brush;
              const value = kind === "hair" ? hair : makeup;
              const setValue = kind === "hair" ? setHair : setMakeup;
              const mine = styles.filter((s) => s.kind === kind);
              return (
                <Card key={kind}>
                  <CardContent className="pt-5 space-y-2.5">
                    <p className="text-sm font-medium flex items-center gap-2 capitalize">
                      <Icon className="h-4 w-4" /> {kind}
                    </p>
                    <Textarea
                      value={value}
                      onChange={(e) => setValue(e.target.value)}
                      rows={2}
                      placeholder={
                        kind === "hair"
                          ? "style only — colour comes from the character"
                          : "e.g. soft glam, glossy nude lip"
                      }
                      className="glass border-white/10 text-xs"
                    />
                    {mine.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {mine.map((p) => (
                          <button
                            key={p.id}
                            onClick={() => setValue(p.description)}
                            className={cn(
                              "flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] border transition-colors",
                              value.trim() === p.description.trim()
                                ? "bg-[oklch(0.75_0.15_270_/_25%)] border-white/20 text-white"
                                : "bg-white/5 border-white/10 text-muted-foreground hover:text-foreground"
                            )}
                            title={p.description}
                          >
                            {p.isDefault && (
                              <Star className="h-2.5 w-2.5" fill="currentColor" />
                            )}
                            {p.name}
                          </button>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>

          {/* Background + aspect */}
          <Card>
            <CardContent className="pt-5 space-y-3">
              <p className="text-sm font-medium flex items-center gap-2">
                <ImagePlus className="h-4 w-4" /> Background
                <span className="text-xs text-muted-foreground font-normal">
                  optional — replaces the saved location
                </span>
              </p>
              <div className="flex flex-wrap gap-1.5">
                <button
                  onClick={() => setBgId(null)}
                  className={cn(
                    "px-2 py-1 rounded-lg text-xs border transition-colors",
                    bgId === null
                      ? "bg-[oklch(0.75_0.15_270_/_20%)] border-white/20"
                      : "glass border-white/10 hover:bg-white/5"
                  )}
                >
                  As saved
                </button>
                {backgrounds.map((b) => (
                  <button
                    key={b.id}
                    onClick={() => setBgId(b.id)}
                    className={cn(
                      "px-2 py-1 rounded-lg text-xs border transition-colors",
                      bgId === b.id
                        ? "bg-[oklch(0.75_0.15_270_/_20%)] border-white/20"
                        : "glass border-white/10 hover:bg-white/5"
                    )}
                    title={b.description}
                  >
                    {b.name}
                  </button>
                ))}
              </div>

              <div className="flex items-center gap-2 pt-1">
                <span className="text-xs text-muted-foreground">Ratio</span>
                {ASPECTS.map((a) => (
                  <button
                    key={a}
                    onClick={() => setAspect(a)}
                    className={cn(
                      "px-2 py-1 rounded-lg text-xs border transition-colors",
                      aspect === a
                        ? "bg-[oklch(0.75_0.15_270_/_20%)] border-white/20"
                        : "glass border-white/10 hover:bg-white/5"
                    )}
                  >
                    {a}
                  </button>
                ))}
              </div>
            </CardContent>
          </Card>

          <Button
            onClick={generate}
            disabled={!character || generating}
            className="w-full rounded-xl bg-[oklch(0.75_0.15_270)] hover:bg-[oklch(0.7_0.15_270)] text-white gap-2 h-11"
          >
            {generating ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Sparkles className="h-4 w-4" />
            )}
            {character
              ? `Generate ${outfits.length || 1} image${(outfits.length || 1) === 1 ? "" : "s"} as ${character.name}`
              : "Pick a character first"}
          </Button>
        </div>
      </div>

      {/* Results */}
      {renders.length > 0 && (
        <div className="space-y-3">
          <p className="text-sm font-medium">Results</p>
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-5 gap-3">
            {renders.map((r) => (
              <div key={r.id} className="p-2 rounded-xl glass space-y-2">
                <div className="flex items-center justify-between gap-1">
                  <span className="text-[10px] font-mono text-muted-foreground">
                    #{r.job.id}
                  </span>
                  <Badge
                    className={`text-[10px] border ${statusColor[r.job.status] || ""}`}
                  >
                    {isActive(r.job.status) && (
                      <Loader2 className="h-2.5 w-2.5 animate-spin mr-1" />
                    )}
                    {r.job.status}
                  </Badge>
                </div>
                {r.job.outputPath ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={fileUrl(r.job.outputPath)}
                    alt={r.outfit}
                    className="w-full aspect-[3/4] rounded-lg object-cover bg-white/5"
                  />
                ) : (
                  <Skeleton className="w-full aspect-[3/4] rounded-lg bg-white/5" />
                )}
                <p
                  className="text-[10px] text-muted-foreground truncate"
                  title={r.outfit}
                >
                  {r.outfit}
                </p>
                {r.job.outputPath && (
                  <a
                    href={fileUrl(r.job.outputPath)}
                    download
                    className="flex items-center justify-center gap-1 text-[10px] rounded-lg border border-white/10 py-1 hover:bg-white/5"
                  >
                    <Download className="h-3 w-3" /> Save
                  </a>
                )}
                {r.job.error && (
                  <p className="text-[10px] text-red-400/80 line-clamp-2">
                    {r.job.error}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
