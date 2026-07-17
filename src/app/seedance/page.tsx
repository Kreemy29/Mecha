"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import {
  Wand2,
  Film,
  Shirt,
  Sparkles,
  Play,
  ThumbsUp,
  ThumbsDown,
  Loader2,
  Upload,
  Link as LinkIcon,
  Download,
  Trash2,
  CheckCircle2,
  Clapperboard,
  ImagePlus,
} from "lucide-react";

interface Character {
  id: number;
  name: string;
  featureProfile: string;
  higgsFieldCharacterRef: string | null;
  baseImagePath: string | null;
}
interface Job {
  id: number;
  status: string;
  outputPath: string | null;
  error: string | null;
  attempts: number;
}

// A reusable background. `description` is frozen text, injected verbatim.
interface SavedBackground {
  id: number;
  name: string;
  description: string;
  imagePath: string | null;
}

// One reference video in the batch.
interface VideoItem {
  id: string;
  name: string;
  videoPath: string;
  durationSeconds: number;
  frames: string[];
  selectedFrame: number | null;
  customFramePath: string | null; // user-uploaded frame (overrides selectedFrame)
}

// One (video × outfit) combination — its own still and video.
interface Variant {
  id: string;
  videoId: string;
  outfit: string;
  recreationPrompt: string;
  writing: boolean;
  stillJobs: Job[];
  approvedStillPath: string | null;
  seedanceJob: Job | null;
}

type Step = "setup" | "videos" | "background" | "outfits" | "stills" | "results";

const STEPS: {
  key: Step;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}[] = [
  { key: "setup", label: "Setup", icon: Wand2 },
  { key: "videos", label: "Videos", icon: Film },
  { key: "background", label: "Background", icon: ImagePlus },
  { key: "outfits", label: "Outfits", icon: Shirt },
  { key: "stills", label: "Stills", icon: Sparkles },
  { key: "results", label: "Seedance", icon: Clapperboard },
];

const fileUrl = (p: string) =>
  p.startsWith("http") ? p : `/api/files/${p.replace(/\\/g, "/")}`;
const uid = () => `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
// The frame we recreate from: a user-uploaded one wins, else the picked extract.
const chosenFrame = (v: VideoItem): string | null =>
  v.customFramePath ?? (v.selectedFrame !== null ? v.frames[v.selectedFrame] : null);
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

const ASPECTS = ["9:16", "1:1", "16:9"];

export default function SeedancePage() {
  const [step, setStep] = useState<Step>("setup");
  const [characters, setCharacters] = useState<Character[]>([]);
  const [selectedCharacter, setSelectedCharacter] = useState<Character | null>(null);
  const [aspectRatio, setAspectRatio] = useState("9:16");
  const [videoProvider, setVideoProvider] = useState<"higgsfield" | "kie">("higgsfield");
  const [kieFast, setKieFast] = useState(false);

  // Videos (batch)
  const [videos, setVideos] = useState<VideoItem[]>([]);
  const [reelUrl, setReelUrl] = useState("");
  const [intaking, setIntaking] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Outfits (shared across all videos)
  const [outfits, setOutfits] = useState<string[]>([]);
  const [newOutfit, setNewOutfit] = useState("");

  // Variants = video × outfit
  const [variants, setVariants] = useState<Variant[]>([]);

  // Background — a FROZEN description is what actually drives the scene, so the
  // same backdrop renders identically on every generation.
  const [backgroundPath, setBackgroundPath] = useState<string | null>(null);
  const [backgroundUrl, setBackgroundUrl] = useState<string | null>(null);
  const [uploadingBg, setUploadingBg] = useState(false);
  const [describingBg, setDescribingBg] = useState(false);
  const [bgDescription, setBgDescription] = useState("");
  const [bgName, setBgName] = useState("");
  const [savedBackgrounds, setSavedBackgrounds] = useState<SavedBackground[]>([]);
  const [selectedBgId, setSelectedBgId] = useState<number | null>(null);
  const bgInputRef = useRef<HTMLInputElement>(null);

  const [generating, setGenerating] = useState(false);

  const variantsRef = useRef<Variant[]>(variants);
  variantsRef.current = variants;

  const patchVariant = useCallback((id: string, patch: Partial<Variant>) => {
    setVariants((prev) => prev.map((v) => (v.id === id ? { ...v, ...patch } : v)));
  }, []);
  const patchVideo = useCallback((id: string, patch: Partial<VideoItem>) => {
    setVideos((prev) => prev.map((v) => (v.id === id ? { ...v, ...patch } : v)));
  }, []);

  const fetchInitialData = useCallback(async () => {
    const [charsRes, bgRes] = await Promise.all([
      fetch("/api/characters"),
      fetch("/api/backgrounds"),
    ]);
    setCharacters(await charsRes.json());
    setSavedBackgrounds(await bgRes.json());
  }, []);
  useEffect(() => {
    fetchInitialData();
  }, [fetchInitialData]);

  const saveBackground = async () => {
    if (!bgName.trim() || !bgDescription.trim()) return;
    try {
      const res = await fetch("/api/backgrounds", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: bgName,
          description: bgDescription,
          imagePath: backgroundPath,
        }),
      });
      const row = await res.json();
      if (row.error) throw new Error(row.error);
      setSavedBackgrounds((prev) => [row, ...prev]);
      setSelectedBgId(row.id);
      setBgName("");
      toast.success(`Saved "${row.name}"`);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to save background");
    }
  };

  const deleteBackground = async (id: number) => {
    try {
      await fetch(`/api/backgrounds?id=${id}`, { method: "DELETE" });
      setSavedBackgrounds((prev) => prev.filter((b) => b.id !== id));
      if (selectedBgId === id) {
        setSelectedBgId(null);
        setBgDescription("");
        setBackgroundUrl(null);
        setBackgroundPath(null);
      }
    } catch {
      toast.error("Failed to delete background");
    }
  };

  // Single poller across every variant's jobs
  useEffect(() => {
    if (!["stills", "results"].includes(step)) return;
    const interval = setInterval(async () => {
      const items = variantsRef.current;
      const anyActive = items.some(
        (v) =>
          v.stillJobs.some((j) => isActive(j.status)) ||
          (v.seedanceJob && isActive(v.seedanceJob.status))
      );
      if (!anyActive) return;
      try {
        const res = await fetch("/api/jobs?limit=300");
        const all: Job[] = await res.json();
        const byId = new Map(all.map((j) => [j.id, j]));
        setVariants((prev) =>
          prev.map((v) => ({
            ...v,
            stillJobs: v.stillJobs.map((j) => byId.get(j.id) || j),
            seedanceJob: v.seedanceJob ? byId.get(v.seedanceJob.id) || v.seedanceJob : null,
          }))
        );
      } catch {
        // silent
      }
    }, 2500);
    return () => clearInterval(interval);
  }, [step]);

  // ── Videos ──
  const addVideo = async (payload: FormData | { reelUrl: string }, name: string) => {
    setIntaking(true);
    try {
      const res = await fetch("/api/references/video", {
        method: "POST",
        ...(payload instanceof FormData
          ? { body: payload }
          : {
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(payload),
            }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);

      const fr = await fetch("/api/references/frames", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ videoPath: data.videoPath, count: 10, seconds: 2 }),
      });
      const fd = await fr.json();
      if (fd.error) throw new Error(fd.error);

      setVideos((prev) => [
        ...prev,
        {
          id: uid(),
          name,
          videoPath: data.videoPath,
          durationSeconds: data.durationSeconds || 0,
          frames: fd.frames || [],
          selectedFrame: null,
          customFramePath: null,
        },
      ]);
      toast.success(`Added ${name}`);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to add video");
    } finally {
      setIntaking(false);
    }
  };

  const handleUploadFiles = async (files: FileList) => {
    for (const file of Array.from(files)) {
      const form = new FormData();
      form.append("file", file);
      await addVideo(form, file.name);
    }
  };
  const handleAddReel = async () => {
    const url = reelUrl.trim();
    if (!url) return;
    await addVideo({ reelUrl: url }, url.split("/").slice(-2).join("/"));
    setReelUrl("");
  };

  const addOutfit = () => {
    const t = newOutfit.trim();
    if (!t) return;
    setOutfits((prev) => [...prev, t]);
    setNewOutfit("");
  };

  // Build one variant per (video with a chosen frame) × outfit
  const buildVariants = () => {
    const ready = videos.filter((v) => chosenFrame(v) !== null);
    const next: Variant[] = [];
    for (const vid of ready) {
      for (const outfit of outfits) {
        const existing = variants.find((x) => x.videoId === vid.id && x.outfit === outfit);
        next.push(
          existing || {
            id: uid(),
            videoId: vid.id,
            outfit,
            recreationPrompt: "",
            writing: false,
            stillJobs: [],
            approvedStillPath: null,
            seedanceJob: null,
          }
        );
      }
    }
    setVariants(next);
    setStep("stills");
  };

  // ── Stills ──
  const generateStill = async (v: Variant) => {
    const vid = videos.find((x) => x.id === v.videoId);
    const frame = vid ? chosenFrame(vid) : null;
    if (!vid || !frame || !selectedCharacter) return;
    if (!selectedCharacter.baseImagePath) {
      toast.error(`${selectedCharacter.name} has no face reference image.`);
      return;
    }
    patchVariant(v.id, { writing: true });
    try {
      const origin = window.location.origin;
      const sceneRefUrl = `${origin}${fileUrl(frame)}`;
      const faceRefUrl = selectedCharacter.baseImagePath.startsWith("http")
        ? selectedCharacter.baseImagePath
        : `${origin}${fileUrl(selectedCharacter.baseImagePath)}`;

      let prompt = v.recreationPrompt;
      if (!prompt.trim()) {
        const pr = await fetch("/api/grok/swap-prompt", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sceneRefUrl,
            faceRefUrl,
            settingDescription: selectedCharacter.featureProfile,
            characterName: selectedCharacter.name,
            outfitOverride: v.outfit,
            // The frozen background text becomes the scene's environment — used
            // verbatim so every still renders the same room.
            backgroundDescription: bgDescription.trim() || undefined,
          }),
        });
        const pd = await pr.json();
        if (pd.error) throw new Error(pd.error);
        prompt = pd.prompt;
      }

      const res = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "image",
          prompt,
          provider: "higgsfield",
          providerModel: "soul_2",
          providerParams: { quality: "2k", aspectRatio: "3:4", sceneRefUrl },
          characterId: selectedCharacter.id,
        }),
      });
      const job = await res.json();
      patchVariant(v.id, {
        recreationPrompt: prompt,
        writing: false,
        stillJobs: [job],
        approvedStillPath: null,
      });
    } catch (err: unknown) {
      patchVariant(v.id, { writing: false });
      toast.error(err instanceof Error ? err.message : "Failed to generate still");
    }
  };

  const generateAllStills = async () => {
    const todo = variantsRef.current.filter((v) => v.stillJobs.length === 0);
    for (const v of todo) await generateStill(v);
    toast.success(`Generating ${todo.length} still(s) — 3 run in parallel`);
  };

  const rejectStill = async (v: Variant, jobId: number) => {
    const notes = window.prompt("What should change about this still?");
    if (!notes?.trim()) return;
    try {
      const res = await fetch(`/api/jobs/${jobId}/reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rejectionNotes: notes }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      patchVariant(v.id, {
        stillJobs: [
          ...v.stillJobs.map((j) => (j.id === jobId ? { ...j, status: "rejected" } : j)),
          data.newJob,
        ],
      });
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to reject");
    }
  };

  // ── Background ──
  const uploadBackground = async (file: File) => {
    setUploadingBg(true);
    try {
      const form = new FormData();
      form.append("files", file);
      const res = await fetch("/api/references/upload", { method: "POST", body: form });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      const r = data.results?.[0];
      if (!r?.path) throw new Error("Upload returned no path");
      setBackgroundPath(r.path);
      setBackgroundUrl(r.imageUrl);
      setSelectedBgId(null);

      // Describe it ONCE — that text is then frozen and reused for every still.
      setDescribingBg(true);
      const dr = await fetch("/api/backgrounds/describe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageUrl: r.imageUrl }),
      });
      const dd = await dr.json();
      if (dd.error) throw new Error(dd.error);
      setBgDescription(dd.description || "");
      toast.success("Background described — edit it, then save it as a preset");
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Background upload failed");
    } finally {
      setUploadingBg(false);
      setDescribingBg(false);
    }
  };

  const approvedCount = variants.filter((v) => v.approvedStillPath).length;

  // ── Seedance ──
  const generateSeedance = async () => {
    const ready = variantsRef.current.filter((v) => v.approvedStillPath);
    if (ready.length === 0) return;
    setGenerating(true);
    try {
      const pr = await fetch("/api/grok/seedance-prompt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const pd = await pr.json();
      if (pd.error) throw new Error(pd.error);
      const prompt = pd.prompt;

      for (const v of ready) {
        const vid = videos.find((x) => x.id === v.videoId);
        if (!vid) continue;
        const res = await fetch("/api/seedance", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            imagePath: v.approvedStillPath,
            videoPath: vid.videoPath,
            prompt,
            duration: vid.durationSeconds || undefined,
            aspectRatio,
            characterId: selectedCharacter?.id,
            outfit: v.outfit,
            provider: videoProvider,
            fast: kieFast,
          }),
        });
        const job = await res.json();
        if (!job.error) patchVariant(v.id, { seedanceJob: job });
      }
      setStep("results");
      toast.success(`Queued ${ready.length} video(s) — 3 render in parallel`);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to start Seedance");
    } finally {
      setGenerating(false);
    }
  };

  const currentStepIndex = STEPS.findIndex((s) => s.key === step);
  const framedVideos = videos.filter((v) => chosenFrame(v) !== null).length;

  // Upload a custom frame for one video (used when none of the extracts fit).
  const uploadCustomFrame = async (videoId: string, file: File) => {
    try {
      const form = new FormData();
      form.append("files", file);
      const res = await fetch("/api/references/upload", { method: "POST", body: form });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      const r = data.results?.[0];
      if (!r?.path) throw new Error("Upload returned no path");
      patchVideo(videoId, { customFramePath: r.path, selectedFrame: null });
      toast.success("Custom frame set");
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Frame upload failed");
    }
  };
  const who = videoProvider === "kie" ? "KIE AI" : "Higgsfield";
  const videoOf = (id: string) => videos.find((v) => v.id === id);

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-3xl font-bold tracking-tight bg-gradient-to-r from-foreground to-foreground/60 bg-clip-text text-transparent">
          Seedance — Video Recreation
        </h2>
        <p className="text-sm text-muted-foreground mt-1">
          Batch: many videos × many outfits &rarr; stills &rarr; background &rarr; Seedance, all in parallel
        </p>
      </div>

      {/* Steps */}
      <div className="flex items-center gap-1 flex-wrap">
        {STEPS.map((s, i) => {
          const Icon = s.icon;
          const active = s.key === step;
          const past = i < currentStepIndex;
          return (
            <button
              key={s.key}
              onClick={() => {
                if (past || active) setStep(s.key);
              }}
              className={`flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-medium transition-all ${
                active
                  ? "glass-strong text-foreground border-white/15"
                  : past
                    ? "text-muted-foreground hover:text-foreground hover:bg-white/5 cursor-pointer"
                    : "text-muted-foreground/40 cursor-default"
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">{s.label}</span>
              {i < STEPS.length - 1 && <span className="ml-2 text-white/10">&rarr;</span>}
            </button>
          );
        })}
      </div>

      {/* ── Setup ── */}
      {step === "setup" && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Select Character</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {characters.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  No characters yet.{" "}
                  <a href="/characters" className="text-[oklch(0.85_0.12_270)] hover:underline">
                    Create one first
                  </a>
                </p>
              ) : (
                characters.map((c) => {
                  const thumb = c.baseImagePath ? fileUrl(c.baseImagePath) : null;
                  return (
                    <button
                      key={c.id}
                      onClick={() => setSelectedCharacter(c)}
                      className={`w-full text-left p-3 rounded-xl transition-all flex gap-3 items-center ${
                        selectedCharacter?.id === c.id
                          ? "glass-strong border-[oklch(0.75_0.15_270_/_30%)]"
                          : "glass hover:bg-white/5"
                      }`}
                    >
                      <div className="h-12 w-12 rounded-lg overflow-hidden bg-white/5 shrink-0">
                        {thumb ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={thumb} alt={c.name} className="h-full w-full object-cover" loading="lazy" />
                        ) : null}
                      </div>
                      <div className="min-w-0">
                        <div className="font-medium text-sm">{c.name}</div>
                        <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">
                          {c.featureProfile}
                        </p>
                      </div>
                    </button>
                  );
                })
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Video Provider &amp; Output</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <p className="text-[11px] text-muted-foreground mb-1.5">Generate with</p>
                <div className="glass rounded-xl p-1 flex text-sm w-fit">
                  {([
                    { key: "higgsfield", label: "Higgsfield" },
                    { key: "kie", label: "KIE AI" },
                  ] as const).map((p) => (
                    <button
                      key={p.key}
                      onClick={() => setVideoProvider(p.key)}
                      className={`px-4 py-1.5 rounded-lg transition-colors ${
                        videoProvider === p.key
                          ? "bg-white/10 text-foreground"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>
              {videoProvider === "kie" && (
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                  <input type="checkbox" checked={kieFast} onChange={(e) => setKieFast(e.target.checked)} />
                  Seedance 2 Fast (cheaper / quicker)
                </label>
              )}
              <div>
                <p className="text-[11px] text-muted-foreground mb-1.5">Aspect ratio</p>
                <div className="glass rounded-xl p-1 flex text-sm w-fit">
                  {ASPECTS.map((a) => (
                    <button
                      key={a}
                      onClick={() => setAspectRatio(a)}
                      className={`px-4 py-1.5 rounded-lg transition-colors ${
                        aspectRatio === a
                          ? "bg-white/10 text-foreground"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {a}
                    </button>
                  ))}
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                Each video&apos;s length is auto-matched. Provider: {who}.
              </p>
            </CardContent>
          </Card>

          <div className="lg:col-span-2 flex justify-end">
            <Button
              disabled={!selectedCharacter}
              onClick={() => setStep("videos")}
              className="rounded-xl bg-[oklch(0.75_0.15_270)] hover:bg-[oklch(0.7_0.15_270)] text-white gap-2"
            >
              Next: Add Videos
              <Film className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {/* ── Videos (batch) ── */}
      {step === "videos" && (
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div>
                  <CardTitle className="text-base">Reference Videos</CardTitle>
                  <p className="text-xs text-muted-foreground mt-1">
                    Add as many as you like — upload multiple files or paste Instagram links. Pick a base frame for each.
                  </p>
                </div>
                {framedVideos > 0 && (
                  <Button
                    onClick={() => setStep("background")}
                    className="rounded-xl bg-[oklch(0.75_0.15_270)] hover:bg-[oklch(0.7_0.15_270)] text-white gap-2"
                  >
                    Next: Background ({framedVideos} video{framedVideos === 1 ? "" : "s"})
                    <ImagePlus className="h-4 w-4" />
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent>
              <div className="flex gap-3 flex-wrap items-center">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="video/*"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    if (e.target.files?.length) handleUploadFiles(e.target.files);
                    e.target.value = "";
                  }}
                />
                <Button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={intaking}
                  variant="outline"
                  className="rounded-xl border-white/10 gap-2"
                >
                  {intaking ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                  Upload videos
                </Button>
                <span className="text-xs text-muted-foreground">or</span>
                <div className="relative flex-1 min-w-[220px]">
                  <LinkIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    value={reelUrl}
                    onChange={(e) => setReelUrl(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleAddReel()}
                    placeholder="https://www.instagram.com/reel/..."
                    className="glass border-white/10 pl-9"
                  />
                </div>
                <Button
                  onClick={handleAddReel}
                  disabled={intaking || !reelUrl.trim()}
                  className="rounded-xl bg-[oklch(0.75_0.15_270)] hover:bg-[oklch(0.7_0.15_270)] text-white gap-2"
                >
                  {intaking ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                  Add
                </Button>
              </div>
            </CardContent>
          </Card>

          {videos.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              No videos yet — add one or more to start the batch.
            </p>
          ) : (
            videos.map((vid) => (
              <Card key={vid.id} className={chosenFrame(vid) ? "ring-1 ring-emerald-500/40" : ""}>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div className="min-w-0">
                      <CardTitle className="text-sm truncate">{vid.name}</CardTitle>
                      <p className="text-[11px] text-muted-foreground mt-0.5">
                        {vid.durationSeconds}s · animation length auto-matches
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {chosenFrame(vid) && (
                        <Badge className="text-xs bg-emerald-500/10 text-emerald-400 border-emerald-500/20 border gap-1">
                          <CheckCircle2 className="h-3 w-3" />
                          {vid.customFramePath ? "Custom frame" : "Frame picked"}
                        </Badge>
                      )}
                      <button
                        onClick={() => setVideos((prev) => prev.filter((x) => x.id !== vid.id))}
                        className="h-7 w-7 rounded-md hover:bg-red-500/20 flex items-center justify-center"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 lg:grid-cols-[200px_1fr] gap-4">
                    <video src={fileUrl(vid.videoPath)} controls muted className="w-full rounded-xl bg-black" />
                    <div>
                      <div className="flex items-center justify-between mb-1.5">
                        <p className="text-[11px] text-muted-foreground">
                          Pick the base frame, or upload your own
                        </p>
                        <label className="text-[11px] text-[oklch(0.85_0.12_270)] hover:underline cursor-pointer flex items-center gap-1">
                          <Upload className="h-3 w-3" />
                          Upload frame
                          <input
                            type="file"
                            accept="image/*"
                            className="hidden"
                            onChange={(e) => {
                              const f = e.target.files?.[0];
                              if (f) uploadCustomFrame(vid.id, f);
                              e.target.value = "";
                            }}
                          />
                        </label>
                      </div>
                      <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
                        {/* Custom uploaded frame appears first, selected */}
                        {vid.customFramePath && (
                          <button
                            onClick={() => patchVideo(vid.id, { customFramePath: null })}
                            title="Uploaded frame — click to remove"
                            className="relative aspect-[3/4] rounded-lg overflow-hidden border-2 border-[oklch(0.75_0.15_270)]"
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={fileUrl(vid.customFramePath)} alt="custom frame" className="w-full h-full object-cover" />
                            <div className="absolute inset-0 flex items-center justify-center bg-[oklch(0.75_0.15_270_/_25%)]">
                              <CheckCircle2 className="h-5 w-5 text-white" />
                            </div>
                            <Badge className="absolute top-1 left-1 text-[8px] bg-black/60 border-white/10">yours</Badge>
                          </button>
                        )}
                        {vid.frames.map((f, i) => (
                          <button
                            key={i}
                            onClick={() => patchVideo(vid.id, { selectedFrame: i, customFramePath: null })}
                            className={`relative aspect-[3/4] rounded-lg overflow-hidden border-2 transition-all ${
                              vid.selectedFrame === i && !vid.customFramePath
                                ? "border-[oklch(0.75_0.15_270)]"
                                : "border-transparent hover:border-white/20"
                            }`}
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={fileUrl(f)} alt={`f${i + 1}`} className="w-full h-full object-cover" loading="lazy" />
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </div>
      )}

      {/* ── Outfits ── */}
      {step === "outfits" && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-base">Outfits</CardTitle>
                <p className="text-xs text-muted-foreground mt-1">
                  Applied to every video. {framedVideos} video{framedVideos === 1 ? "" : "s"} ×{" "}
                  {outfits.length} outfit{outfits.length === 1 ? "" : "s"} ={" "}
                  <strong>{framedVideos * outfits.length}</strong> stills / videos.
                </p>
              </div>
              {outfits.length > 0 && (
                <Button
                  onClick={buildVariants}
                  className="rounded-xl bg-[oklch(0.75_0.15_270)] hover:bg-[oklch(0.7_0.15_270)] text-white gap-2"
                >
                  Next: Stills ({framedVideos * outfits.length})
                  <Sparkles className="h-4 w-4" />
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex gap-2">
              <Input
                value={newOutfit}
                onChange={(e) => setNewOutfit(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addOutfit()}
                placeholder="e.g. red sequin mini dress with thin straps"
                className="glass border-white/10"
              />
              <Button
                onClick={addOutfit}
                disabled={!newOutfit.trim()}
                className="rounded-xl bg-[oklch(0.75_0.15_270)] hover:bg-[oklch(0.7_0.15_270)] text-white gap-2"
              >
                <Shirt className="h-4 w-4" /> Add
              </Button>
            </div>
            {outfits.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">Add one or more outfits.</p>
            ) : (
              <div className="space-y-2">
                {outfits.map((o, i) => (
                  <div key={i} className="flex items-center gap-3 p-3 rounded-xl glass">
                    <Badge className="text-[10px] bg-white/5 border-white/10">{i + 1}</Badge>
                    <span className="text-sm flex-1">{o}</span>
                    <button
                      onClick={() => setOutfits((prev) => prev.filter((_, j) => j !== i))}
                      className="h-7 w-7 rounded-md hover:bg-red-500/20 flex items-center justify-center"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── Stills ── */}
      {step === "stills" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between glass-strong rounded-2xl p-3 flex-wrap gap-2">
            <p className="text-sm text-muted-foreground">
              {approvedCount} of {variants.length} stills approved
            </p>
            <div className="flex gap-2">
              <Button
                onClick={generateAllStills}
                variant="outline"
                className="rounded-xl border-white/10 gap-2"
              >
                <Sparkles className="h-4 w-4" />
                Generate all stills
              </Button>
              <Button
                onClick={generateSeedance}
                disabled={approvedCount === 0 || generating}
                className="rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white gap-2"
              >
                {generating ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Play className="h-4 w-4" />
                )}
                Generate {approvedCount} video{approvedCount === 1 ? "" : "s"} on {who}
              </Button>
            </div>
          </div>

          {videos
            .filter((vid) => chosenFrame(vid) !== null)
            .map((vid) => (
              <div key={vid.id} className="space-y-2">
                <p className="text-xs text-muted-foreground font-mono">{vid.name}</p>
                {variants
                  .filter((v) => v.videoId === vid.id)
                  .map((v) => {
                    const stillActive = v.stillJobs.some((j) => isActive(j.status));
                    const ready = !!v.approvedStillPath;
                    return (
                      <Card key={v.id} className={ready ? "ring-1 ring-emerald-500/40" : ""}>
                        <CardHeader>
                          <div className="flex items-center justify-between">
                            <CardTitle className="text-sm">{v.outfit}</CardTitle>
                            {ready ? (
                              <Badge className="text-xs bg-emerald-500/10 text-emerald-400 border-emerald-500/20 border gap-1">
                                <CheckCircle2 className="h-3 w-3" /> Approved
                              </Badge>
                            ) : (
                              <Button
                                onClick={() => generateStill(v)}
                                disabled={v.writing || stillActive}
                                size="sm"
                                className="rounded-xl bg-[oklch(0.75_0.15_270)] hover:bg-[oklch(0.7_0.15_270)] text-white gap-2"
                              >
                                {v.writing || stillActive ? (
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                  <Sparkles className="h-4 w-4" />
                                )}
                                {v.stillJobs.length ? "Regenerate" : "Generate Still"}
                              </Button>
                            )}
                          </div>
                        </CardHeader>
                        {v.stillJobs.length > 0 && (
                          <CardContent>
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                              {v.stillJobs.map((job) => {
                                const approved = v.approvedStillPath === job.outputPath;
                                return (
                                  <div
                                    key={job.id}
                                    className={`p-2 rounded-xl glass space-y-2 ${approved ? "ring-2 ring-emerald-500/50" : ""}`}
                                  >
                                    <div className="flex items-center justify-between">
                                      <span className="text-[10px] font-mono text-muted-foreground">#{job.id}</span>
                                      <Badge className={`text-[10px] border ${statusColor[job.status] || ""}`}>
                                        {isActive(job.status) && <Loader2 className="h-2.5 w-2.5 animate-spin mr-1" />}
                                        {job.status}
                                      </Badge>
                                    </div>
                                    {job.outputPath ? (
                                      // eslint-disable-next-line @next/next/no-img-element
                                      <img src={fileUrl(job.outputPath)} alt="still" className="w-full aspect-[3/4] rounded-lg object-cover bg-white/5" />
                                    ) : (
                                      <Skeleton className="w-full aspect-[3/4] rounded-lg bg-white/5" />
                                    )}
                                    {job.status === "succeeded" && job.outputPath && (
                                      <div className="flex gap-1">
                                        <Button
                                          onClick={() => patchVariant(v.id, { approvedStillPath: job.outputPath })}
                                          size="sm"
                                          className="flex-1 h-7 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white gap-1 text-xs"
                                        >
                                          <ThumbsUp className="h-3 w-3" /> Use
                                        </Button>
                                        <Button
                                          onClick={() => rejectStill(v, job.id)}
                                          size="sm"
                                          variant="outline"
                                          className="h-7 rounded-lg border-white/10 px-2"
                                        >
                                          <ThumbsDown className="h-3 w-3" />
                                        </Button>
                                      </div>
                                    )}
                                    {job.error && (
                                      <p className="text-[10px] text-red-400/80 line-clamp-2">{job.error}</p>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          </CardContent>
                        )}
                      </Card>
                    );
                  })}
              </div>
            ))}
        </div>
      )}

      {/* ── Background: pick a saved preset, or add one (described ONCE, frozen) ── */}
      {step === 'background' && (
        <div className='space-y-4'>
          <Card>
            <CardHeader>
              <div className='flex items-center justify-between flex-wrap gap-2'>
                <div>
                  <CardTitle className='text-base'>Background (optional)</CardTitle>
                  <p className='text-xs text-muted-foreground mt-1'>
                    Pick a saved background — its description is reused word-for-word, so the same backdrop renders
                    identically every time. Skip to keep each frame&apos;s own background.
                  </p>
                </div>
                <Button
                  onClick={() => setStep('outfits')}
                  className='rounded-xl bg-[oklch(0.75_0.15_270)] hover:bg-[oklch(0.7_0.15_270)] text-white gap-2'
                >
                  {bgDescription.trim() ? 'Next: Outfits' : 'Skip — keep frame background'}
                  <Shirt className='h-4 w-4' />
                </Button>
              </div>
            </CardHeader>
            <CardContent className='space-y-4'>
              {/* Saved presets */}
              <div>
                <p className='text-[11px] text-muted-foreground mb-2'>Saved backgrounds</p>
                {savedBackgrounds.length === 0 ? (
                  <p className='text-xs text-muted-foreground'>None saved yet — add one below.</p>
                ) : (
                  <div className='flex gap-3 flex-wrap'>
                    {savedBackgrounds.map((b) => {
                      const active = selectedBgId === b.id;
                      return (
                        <div
                          key={b.id}
                          className={`relative w-40 rounded-xl p-2 transition-all cursor-pointer ${
                            active
                              ? "glass-strong ring-2 ring-emerald-500/50"
                              : "glass hover:bg-white/5"
                          }`}
                          onClick={() => {
                            setSelectedBgId(b.id);
                            setBgDescription(b.description);
                            setBackgroundUrl(b.imagePath ? fileUrl(b.imagePath) : null);
                          }}
                        >
                          {b.imagePath ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={fileUrl(b.imagePath)} alt={b.name} className='w-full aspect-video rounded-lg object-cover' />
                          ) : (
                            <div className='w-full aspect-video rounded-lg bg-white/5' />
                          )}
                          <p className='text-xs mt-1 truncate'>{b.name}</p>
                          {active && (
                            <Badge className='text-[9px] bg-emerald-500/10 text-emerald-400 border-emerald-500/20 border mt-1'>
                              in use
                            </Badge>
                          )}
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              deleteBackground(b.id);
                            }}
                            className='absolute top-1 right-1 h-6 w-6 rounded-md bg-black/50 hover:bg-red-500/40 flex items-center justify-center'
                          >
                            <Trash2 className='h-3 w-3' />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className='h-px bg-white/10' />

              {/* Add / edit */}
              <div className='space-y-3'>
                <div className='flex gap-2 items-center flex-wrap'>
                  <input
                    ref={bgInputRef}
                    type='file'
                    accept='image/*'
                    className='hidden'
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) uploadBackground(f);
                      e.target.value = '';
                    }}
                  />
                  <Button
                    onClick={() => bgInputRef.current?.click()}
                    disabled={uploadingBg || describingBg}
                    variant='outline'
                    className='rounded-xl border-white/10 gap-2'
                  >
                    {uploadingBg || describingBg ? (
                      <Loader2 className='h-4 w-4 animate-spin' />
                    ) : (
                      <ImagePlus className='h-4 w-4' />
                    )}
                    {describingBg ? 'Describing…' : 'Add background from image'}
                  </Button>
                  {bgDescription.trim() && (
                    <>
                      <Input
                        value={bgName}
                        onChange={(e) => setBgName(e.target.value)}
                        placeholder='name it (e.g. hotel room)'
                        className='glass border-white/10 w-56'
                      />
                      <Button
                        onClick={saveBackground}
                        disabled={!bgName.trim()}
                        className='rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white gap-2'
                      >
                        <CheckCircle2 className='h-4 w-4' /> Save preset
                      </Button>
                    </>
                  )}
                </div>

                {backgroundUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={backgroundUrl} alt='background' className='h-40 rounded-xl object-cover border border-white/10' />
                )}

                {bgDescription.trim() ? (
                  <div>
                    <p className='text-[11px] text-muted-foreground mb-1'>
                      Frozen description — injected verbatim as the scene environment. Edit it and it stays exactly
                      as written for every generation.
                    </p>
                    <Textarea
                      value={bgDescription}
                      onChange={(e) => {
                        setBgDescription(e.target.value);
                        setSelectedBgId(null);
                      }}
                      rows={4}
                      className='glass border-white/10 resize-none text-xs'
                    />
                  </div>
                ) : (
                  <p className='text-xs text-muted-foreground'>
                    Upload a location photo — it&apos;s described once, then that exact text is reused for every still.
                  </p>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      )}


      {/* ── Results ── */}
      {step === "results" && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {variants
            .filter((v) => v.seedanceJob)
            .map((v) => (
              <Card key={v.id}>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div className="min-w-0">
                      <CardTitle className="text-sm truncate">{v.outfit}</CardTitle>
                      <p className="text-[10px] text-muted-foreground font-mono mt-0.5">
                        {videoOf(v.videoId)?.name}
                      </p>
                    </div>
                    <Badge className={`text-xs border ${statusColor[v.seedanceJob!.status] || ""}`}>
                      {isActive(v.seedanceJob!.status) && <Loader2 className="h-3 w-3 animate-spin mr-1" />}
                      {v.seedanceJob!.status}
                    </Badge>
                  </div>
                  <p className="text-[11px] mt-1 text-muted-foreground">
                    {(() => {
                      const j = v.seedanceJob!;
                      if (j.status === "queued")
                        return j.attempts > 0
                          ? `⚠ NSFW-filtered ${j.attempts}× — waiting to auto-retry`
                          : "⏳ waiting for a generation slot…";
                      if (j.status === "running") return `⬆ uploading & submitting to ${who}…`;
                      if (j.status === "polling")
                        return `🎬 rendering on ${who}${j.attempts > 0 ? ` (retry #${j.attempts})` : ""} — a few minutes`;
                      if (j.status === "succeeded") return "✅ done";
                      if (j.status === "failed") return `❌ ${j.error || "failed"}`;
                      return j.status;
                    })()}
                  </p>
                </CardHeader>
                <CardContent>
                  {v.seedanceJob!.outputPath ? (
                    <div className="space-y-2">
                      <video src={fileUrl(v.seedanceJob!.outputPath)} controls loop className="w-full rounded-xl bg-black" />
                      <a
                        href={fileUrl(v.seedanceJob!.outputPath)}
                        download={`seedance-${v.seedanceJob!.id}.mp4`}
                        className="inline-flex items-center gap-2 text-xs text-[oklch(0.85_0.12_270)] hover:underline"
                      >
                        <Download className="h-3.5 w-3.5" /> Download
                      </a>
                    </div>
                  ) : (
                    <div className="w-full aspect-[9/16] max-h-[60vh] rounded-xl bg-white/5 flex items-center justify-center">
                      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground/40" />
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
