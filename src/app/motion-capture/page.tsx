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
  Play,
  ThumbsUp,
  ThumbsDown,
  Loader2,
  Upload,
  Link as LinkIcon,
  Download,
  Sparkles,
  Trash2,
  CheckCircle2,
  Brush,
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
  prompt: string | null;
  outputPath: string | null;
  error: string | null;
  promptHistory: Array<Record<string, unknown>>;
}
interface ProviderModel {
  key: string;
  label: string;
}
interface ProviderInfo {
  id: string;
  name: string;
  models: ProviderModel[];
}

// One driving video and everything derived from it.
interface VideoItem {
  id: string;
  name: string;
  videoPath: string;
  durationSeconds: number; // auto-detected — animation matches the source length
  frames: string[];
  selectedFrame: number | null;
  recreationPrompt: string;
  writing: boolean;
  batchSize: number;
  stillJobs: Job[];
  approvedStillPath: string | null;
  animateJob: Job | null;
  // Frame-extraction window, so it can be re-run from any point in the clip.
  frameStart?: number;
  frameWindow?: number;
  extracting?: boolean;
}

type Step = "setup" | "videos" | "work" | "results";

const STEPS: {
  key: Step;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}[] = [
  { key: "setup", label: "Setup", icon: Wand2 },
  { key: "videos", label: "Add Videos", icon: Film },
  { key: "work", label: "Frames & Stills", icon: Sparkles },
  { key: "results", label: "Results", icon: ThumbsUp },
];

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

export default function MotionCapturePage() {
  const [step, setStep] = useState<Step>("setup");
  const [characters, setCharacters] = useState<Character[]>([]);
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [selectedCharacter, setSelectedCharacter] = useState<Character | null>(
    null
  );
  const [selectedProvider, setSelectedProvider] = useState("higgsfield");
  const [selectedModel, setSelectedModel] = useState("soul_2");

  const [videos, setVideos] = useState<VideoItem[]>([]);
  const [reelUrl, setReelUrl] = useState("");
  const [intaking, setIntaking] = useState(false);
  const [animating, setAnimating] = useState(false);

  // Which motion-transfer engine drives the batch. Both take the same inputs
  // (approved still + driving clip), so this is a per-batch swap.
  const [animateEngine, setAnimateEngine] = useState<"runninghub" | "kling">(
    "runninghub"
  );
  const [klingResolution, setKlingResolution] = useState<"720p" | "1080p">(
    "720p"
  );
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Keep a ref to the latest videos so the single polling interval isn't stale.
  const videosRef = useRef<VideoItem[]>(videos);
  videosRef.current = videos;

  const patchVideo = useCallback(
    (id: string, patch: Partial<VideoItem>) => {
      setVideos((prev) =>
        prev.map((v) => (v.id === id ? { ...v, ...patch } : v))
      );
    },
    []
  );

  const fetchInitialData = useCallback(async () => {
    const [charsRes, providersRes] = await Promise.all([
      fetch("/api/characters"),
      fetch("/api/providers"),
    ]);
    setCharacters(await charsRes.json());
    setProviders(await providersRes.json());
  }, []);

  useEffect(() => {
    fetchInitialData();
  }, [fetchInitialData]);

  // ── Import handoff from the Instagram page ──
  // /motion-capture?import=<videoPath>&name=...&duration=... — the video is
  // already downloaded; just extract frames and drop it into the batch.
  const importedRef = useRef(false);
  useEffect(() => {
    if (importedRef.current) return;
    const sp = new URLSearchParams(window.location.search);
    const videoPath = sp.get("import");
    if (!videoPath) return;
    importedRef.current = true;
    const name = sp.get("name") || "instagram import";
    const duration = parseFloat(sp.get("duration") || "0") || 0;
    window.history.replaceState({}, "", window.location.pathname);
    (async () => {
      setIntaking(true);
      try {
        const framesRes = await fetch("/api/references/frames", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ videoPath, count: 10, seconds: 2 }),
        });
        const framesData = await framesRes.json();
        if (framesData.error) throw new Error(framesData.error);
        setVideos((prev) => [
          ...prev,
          {
            id: uid(),
            name,
            videoPath,
            durationSeconds: duration > 0 ? duration : 5,
            frames: framesData.frames || [],
            selectedFrame: null,
            recreationPrompt: "",
            writing: false,
            batchSize: 1,
            stillJobs: [],
            approvedStillPath: null,
            animateJob: null,
          },
        ]);
        toast.success(`Imported ${name} — it's waiting in the Add Videos step`);
      } catch (err: unknown) {
        toast.error(err instanceof Error ? err.message : "Import failed");
      } finally {
        setIntaking(false);
      }
    })();
  }, []);

  // ── Single poller: reconcile every still job + animate job by id ──
  useEffect(() => {
    if (step !== "work" && step !== "results") return;
    const interval = setInterval(async () => {
      const vids = videosRef.current;
      const anyActive = vids.some(
        (v) =>
          v.stillJobs.some((j) => isActive(j.status)) ||
          (v.animateJob && isActive(v.animateJob.status))
      );
      if (!anyActive) return;
      try {
        const res = await fetch("/api/jobs?limit=200");
        const all: Job[] = await res.json();
        const byId = new Map(all.map((j) => [j.id, j]));
        setVideos((prev) =>
          prev.map((v) => ({
            ...v,
            stillJobs: v.stillJobs.map((j) => byId.get(j.id) || j),
            animateJob: v.animateJob
              ? byId.get(v.animateJob.id) || v.animateJob
              : null,
          }))
        );
      } catch {
        // silent
      }
    }, 2500);
    return () => clearInterval(interval);
  }, [step]);

  const canProceedSetup =
    selectedCharacter && selectedProvider && selectedModel;
  const currentProviderInfo = providers.find((p) => p.id === selectedProvider);

  // ── Add a video (upload or reel) → extract frames → push item ──
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

      const framesRes = await fetch("/api/references/frames", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ videoPath: data.videoPath, count: 10, seconds: 2 }),
      });
      const framesData = await framesRes.json();
      if (framesData.error) throw new Error(framesData.error);

      setVideos((prev) => [
        ...prev,
        {
          id: uid(),
          name,
          videoPath: data.videoPath,
          durationSeconds: data.durationSeconds && data.durationSeconds > 0 ? data.durationSeconds : 5,
          frames: framesData.frames || [],
          selectedFrame: null,
          recreationPrompt: "",
          writing: false,
          batchSize: 1,
          stillJobs: [],
          approvedStillPath: null,
          animateJob: null,
        },
      ]);
      toast.success(`Added ${name}`);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to add video");
    } finally {
      setIntaking(false);
    }
  };

  // Re-extract a video's candidate frames from a different point in the clip.
  // The opening seconds are often blurred or a title card, so the usable pose
  // is frequently further in.
  const reextractFrames = async (vid: VideoItem) => {
    const start = vid.frameStart ?? 0;
    const windowSecs = vid.frameWindow ?? 2;
    patchVideo(vid.id, { extracting: true });
    try {
      const res = await fetch("/api/references/frames", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          videoPath: vid.videoPath,
          count: 10,
          seconds: windowSecs,
          start,
        }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      if (!data.frames?.length) throw new Error("No frames at that position");
      patchVideo(vid.id, {
        frames: data.frames,
        selectedFrame: null,
        recreationPrompt: "",
        stillJobs: [],
        approvedStillPath: null,
        extracting: false,
      });
      toast.success(`Frames from ${start}s–${start + windowSecs}s`);
    } catch (err: unknown) {
      patchVideo(vid.id, { extracting: false });
      toast.error(err instanceof Error ? err.message : "Re-extract failed");
    }
  };

  // Send a finished still through nano-banana with an edit instruction; the
  // result joins the same card as another candidate.
  const postProcessStill = async (v: VideoItem, jobId: number, outputPath: string) => {
    const instruction = window.prompt(
      "Post-process — describe the edit (sent with the image to Nano Banana):"
    );
    if (!instruction?.trim()) return;
    try {
      const res = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "image",
          prompt: instruction,
          provider: "higgsfield",
          providerModel: "nano_banana_pro",
          providerParams: { aspectRatio: "9:16", mediaRefs: [outputPath] },
          characterId: selectedCharacter?.id,
        }),
      });
      const newJob = await res.json();
      if (newJob.error) throw new Error(newJob.error);
      patchVideo(v.id, { stillJobs: [...v.stillJobs, newJob] });
      toast.success("Post-process queued — the edit appears as a new candidate");
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Post-process failed");
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

  const removeVideo = (id: string) =>
    setVideos((prev) => prev.filter((v) => v.id !== id));

  // ── Per-video: write recreation prompt from the picked frame + generate still ──
  const generateStill = async (v: VideoItem) => {
    if (v.selectedFrame === null || !selectedCharacter) return;
    if (!selectedCharacter.baseImagePath) {
      toast.error(`${selectedCharacter.name} has no face reference image.`);
      return;
    }
    patchVideo(v.id, { writing: true });
    try {
      const origin = window.location.origin;
      const sceneRefUrl = `${origin}${fileUrl(v.frames[v.selectedFrame])}`;
      const faceRefUrl = selectedCharacter.baseImagePath.startsWith("http")
        ? selectedCharacter.baseImagePath
        : `${origin}${fileUrl(selectedCharacter.baseImagePath)}`;

      // Reuse an already-written prompt on regenerate; otherwise ask Grok.
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
          }),
        });
        const pd = await pr.json();
        if (pd.error) throw new Error(pd.error);
        prompt = pd.prompt;
      }

      const newJobs: Job[] = [];
      for (let i = 0; i < v.batchSize; i++) {
        const res = await fetch("/api/jobs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            kind: "image",
            prompt,
            provider: selectedProvider,
            providerModel: selectedModel,
            // 9:16 to match the driving reel — a 3:4 still animated into a
            // vertical clip comes out stretched.
            providerParams: { quality: "2k", aspectRatio: "9:16", sceneRefUrl },
            characterId: selectedCharacter.id,
          }),
        });
        newJobs.push(await res.json());
      }
      patchVideo(v.id, {
        recreationPrompt: prompt,
        writing: false,
        stillJobs: newJobs,
        approvedStillPath: null,
      });
    } catch (err: unknown) {
      patchVideo(v.id, { writing: false });
      toast.error(err instanceof Error ? err.message : "Failed to generate still");
    }
  };

  const rejectStill = async (v: VideoItem, jobId: number) => {
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
      patchVideo(v.id, {
        stillJobs: [
          ...v.stillJobs.map((j) =>
            j.id === jobId ? { ...j, status: "rejected" } : j
          ),
          data.newJob,
        ],
      });
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to reject");
    }
  };

  const readyCount = videos.filter((v) => v.approvedStillPath).length;

  // ── Fire animate jobs for every video with an approved still ──
  const animateAll = async () => {
    const ready = videos.filter((v) => v.approvedStillPath);
    if (ready.length === 0) return;
    const ok = window.confirm(
      `Animate ${ready.length} clip${ready.length === 1 ? "" : "s"}?\n\n` +
        `Wan Animate runs ~8 min each on the Plus instance and uses RunningHub credits.\n` +
        `They run one at a time, so total ≈ ${ready.length * 8} min.`
    );
    if (!ok) return;

    setAnimating(true);
    try {
      for (const v of ready) {
        const res = await fetch("/api/animate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            imagePath: v.approvedStillPath,
            videoPath: v.videoPath,
            characterId: selectedCharacter?.id,
            seconds: v.durationSeconds, // match the source video length
            engine: animateEngine,
            // Kling-only; ignored by Wan.
            resolution: klingResolution,
            sceneControl: "image", // keep the backdrop baked into the still
          }),
        });
        const job = await res.json();
        if (!job.error) patchVideo(v.id, { animateJob: job });
      }
      setStep("results");
      toast.success(`Queued ${ready.length} animate job(s)`);
    } finally {
      setAnimating(false);
    }
  };

  const currentStepIndex = STEPS.findIndex((s) => s.key === step);

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-3xl font-bold tracking-tight bg-gradient-to-r from-foreground to-foreground/60 bg-clip-text text-transparent">
          Motion Control — Batch
        </h2>
        <p className="text-sm text-muted-foreground mt-1">
          Add many videos &rarr; pick a frame &amp; approve a still for each &rarr; animate them all with Wan
        </p>
      </div>

      {/* Step indicator */}
      <div className="flex items-center gap-1">
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
              {i < STEPS.length - 1 && (
                <span className="ml-2 text-white/10">&rarr;</span>
              )}
            </button>
          );
        })}
      </div>

      {/* ── STEP: Setup ── */}
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
              <CardTitle className="text-sm">Still Recreation Model</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap gap-2">
                {providers.map((prov) =>
                  prov.models.map((model) => {
                    const sel =
                      selectedProvider === prov.id && selectedModel === model.key;
                    return (
                      <button
                        key={`${prov.id}:${model.key}`}
                        onClick={() => {
                          setSelectedProvider(prov.id);
                          setSelectedModel(model.key);
                        }}
                        className={`text-left p-3 rounded-xl transition-all min-w-[150px] flex-1 ${
                          sel
                            ? "glass-strong border-[oklch(0.75_0.15_270_/_30%)]"
                            : "glass hover:bg-white/5"
                        }`}
                      >
                        <span className="font-medium text-sm">{model.label}</span>
                        <p className="text-[10px] text-muted-foreground/50 font-mono mt-1">
                          {prov.name}
                        </p>
                      </button>
                    );
                  })
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                Animation length auto-matches each source video&apos;s duration.
              </p>
            </CardContent>
          </Card>

          {/* Motion engine — both take the approved still + driving clip, so
              this swaps freely per batch. */}
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle className="text-sm">Motion Engine</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex gap-3 flex-wrap">
                {(
                  [
                    {
                      id: "runninghub" as const,
                      label: "Wan Animate",
                      sub: "RunningHub · needs Plus 48G",
                    },
                    {
                      id: "kling" as const,
                      label: "Kling 3.0 Motion Control",
                      sub: "Higgsfield · motion_control",
                    },
                  ]
                ).map((e) => (
                  <button
                    key={e.id}
                    onClick={() => setAnimateEngine(e.id)}
                    className={`text-left p-3 rounded-xl transition-all min-w-[190px] flex-1 ${
                      animateEngine === e.id
                        ? "glass-strong border-[oklch(0.75_0.15_270_/_30%)]"
                        : "glass hover:bg-white/5"
                    }`}
                  >
                    <span className="font-medium text-sm">{e.label}</span>
                    <p className="text-[10px] text-muted-foreground/50 font-mono mt-1">
                      {e.sub}
                    </p>
                  </button>
                ))}
              </div>

              {animateEngine === "kling" && (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">Resolution</span>
                  {(["720p", "1080p"] as const).map((r) => (
                    <button
                      key={r}
                      onClick={() => setKlingResolution(r)}
                      className={`px-2.5 py-1 rounded-lg text-xs border transition-colors ${
                        klingResolution === r
                          ? "bg-[oklch(0.75_0.15_270_/_20%)] border-white/20"
                          : "glass border-white/10 hover:bg-white/5"
                      }`}
                    >
                      {r}
                      {r === "720p" && (
                        <span className="text-muted-foreground/60 ml-1">
                          cheaper
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              )}

              <p className="text-xs text-muted-foreground">
                {animateEngine === "kling"
                  ? "Kling takes no prompt — the backdrop comes from your approved still."
                  : "Wan replaces the character in the driving clip."}
              </p>
            </CardContent>
          </Card>

          <div className="lg:col-span-2 flex justify-end">
            <Button
              disabled={!canProceedSetup}
              onClick={() => setStep("videos")}
              className="rounded-xl bg-[oklch(0.75_0.15_270)] hover:bg-[oklch(0.7_0.15_270)] text-white gap-2"
            >
              Next: Add Videos
              <Film className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {/* ── STEP: Add Videos ── */}
      {step === "videos" && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-base">Add Driving Videos</CardTitle>
                <p className="text-xs text-muted-foreground mt-1">
                  Upload files or paste Instagram links. Each is added to the batch and its frames extracted.
                </p>
              </div>
              {videos.length > 0 && (
                <Button
                  onClick={() => setStep("work")}
                  className="rounded-xl bg-[oklch(0.75_0.15_270)] hover:bg-[oklch(0.7_0.15_270)] text-white gap-2"
                >
                  Next: Frames &amp; Stills ({videos.length})
                  <Sparkles className="h-4 w-4" />
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-5">
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

            {videos.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">
                No videos added yet. Upload or paste a link to start the batch.
              </p>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                {videos.map((v) => (
                  <div key={v.id} className="relative rounded-xl overflow-hidden glass p-2">
                    <video
                      src={fileUrl(v.videoPath)}
                      className="w-full aspect-video rounded-lg object-cover bg-black"
                      muted
                    />
                    <p className="text-[10px] text-muted-foreground truncate mt-1">{v.name}</p>
                    <p className="text-[10px] text-muted-foreground/60">{v.frames.length} frames</p>
                    <button
                      onClick={() => removeVideo(v.id)}
                      className="absolute top-1 right-1 h-6 w-6 rounded-md bg-black/50 hover:bg-red-500/40 flex items-center justify-center"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── STEP: Work (guided per-video) ── */}
      {step === "work" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between glass-strong rounded-2xl p-3">
            <p className="text-sm text-muted-foreground">
              {readyCount} of {videos.length} ready to animate
            </p>
            <Button
              onClick={animateAll}
              disabled={readyCount === 0 || animating}
              className="rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white gap-2"
            >
              {animating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              Animate All Ready ({readyCount}) on{" "}
              {animateEngine === "kling" ? "Kling" : "Wan"}
            </Button>
          </div>

          {videos.map((v) => (
            <VideoWorkCard
              key={v.id}
              v={v}
              characterName={selectedCharacter?.name || ""}
              onSelectFrame={(idx) =>
                patchVideo(v.id, { selectedFrame: idx, recreationPrompt: "", stillJobs: [], approvedStillPath: null })
              }
              onPromptChange={(p) => patchVideo(v.id, { recreationPrompt: p })}
              onBatchSize={(n) => patchVideo(v.id, { batchSize: n })}
              onGenerate={() => generateStill(v)}
              onApprove={(path) => patchVideo(v.id, { approvedStillPath: path })}
              onReject={(jobId) => rejectStill(v, jobId)}
              onWindowChange={(patch) => patchVideo(v.id, patch)}
              onReextract={() => reextractFrames(v)}
              onPostProcess={(jobId, outputPath) =>
                postProcessStill(v, jobId, outputPath)
              }
            />
          ))}
        </div>
      )}

      {/* ── STEP: Results ── */}
      {step === "results" && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {videos
            .filter((v) => v.animateJob)
            .map((v) => (
              <Card key={v.id}>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-sm truncate">{v.name}</CardTitle>
                    <Badge className={`text-xs border ${statusColor[v.animateJob!.status] || ""}`}>
                      {isActive(v.animateJob!.status) && <Loader2 className="h-3 w-3 animate-spin mr-1" />}
                      {v.animateJob!.status}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent>
                  {v.animateJob!.outputPath ? (
                    <div className="space-y-2">
                      <video
                        src={fileUrl(v.animateJob!.outputPath)}
                        controls
                        loop
                        className="w-full rounded-xl bg-black"
                      />
                      <a
                        href={fileUrl(v.animateJob!.outputPath)}
                        download={`mecha-animate-${v.animateJob!.id}.mp4`}
                        className="inline-flex items-center gap-2 text-xs text-[oklch(0.85_0.12_270)] hover:underline"
                      >
                        <Download className="h-3.5 w-3.5" /> Download
                      </a>
                    </div>
                  ) : v.animateJob!.status === "failed" ? (
                    <p className="text-xs text-red-400/80">{v.animateJob!.error}</p>
                  ) : (
                    <div className="w-full aspect-video rounded-xl bg-white/5 flex items-center justify-center">
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

// ── Per-video guided card: pick frame → generate still → approve ──
function VideoWorkCard({
  v,
  characterName,
  onSelectFrame,
  onPromptChange,
  onBatchSize,
  onGenerate,
  onApprove,
  onReject,
  onWindowChange,
  onReextract,
  onPostProcess,
}: {
  v: VideoItem;
  characterName: string;
  onSelectFrame: (idx: number) => void;
  onPromptChange: (p: string) => void;
  onBatchSize: (n: number) => void;
  onGenerate: () => void;
  onApprove: (path: string) => void;
  onReject: (jobId: number) => void;
  onWindowChange: (patch: { frameStart?: number; frameWindow?: number }) => void;
  onReextract: () => void;
  onPostProcess: (jobId: number, outputPath: string) => void;
}) {
  const stillActive = v.stillJobs.some((j) => isActive(j.status));
  const ready = !!v.approvedStillPath;

  return (
    <Card className={ready ? "ring-1 ring-emerald-500/40" : ""}>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="min-w-0">
            <CardTitle className="text-sm truncate">{v.name}</CardTitle>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              animation length: {v.durationSeconds}s (matches source)
            </p>
          </div>
          {ready ? (
            <Badge className="text-xs bg-emerald-500/10 text-emerald-400 border-emerald-500/20 border gap-1">
              <CheckCircle2 className="h-3 w-3" /> Ready
            </Badge>
          ) : v.selectedFrame === null ? (
            <Badge className="text-xs bg-white/5 border-white/10 border">Pick a frame</Badge>
          ) : (
            <Badge className="text-xs bg-white/5 border-white/10 border">Generate &amp; approve a still</Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 lg:grid-cols-[200px_1fr] gap-4">
          {/* driving video */}
          <video src={fileUrl(v.videoPath)} controls muted className="w-full rounded-xl bg-black" />

          <div className="space-y-3">
            {/* frame strip */}
            <div>
              <p className="text-[11px] text-muted-foreground mb-1.5">Pick the frame to recreate</p>

              {/* Seek the extraction window — the usable pose is often well
                  past the opening seconds. */}
              <div className="flex items-center gap-2 flex-wrap mb-2 text-[11px]">
                <span className="text-muted-foreground">From</span>
                <Input
                  type="number"
                  min={0}
                  max={Math.max(0, Math.floor(v.durationSeconds) - 1)}
                  value={v.frameStart ?? 0}
                  onChange={(e) =>
                    onWindowChange({
                      frameStart: Math.max(0, Number(e.target.value) || 0),
                    })
                  }
                  className="glass border-white/10 h-7 w-16 text-[11px] px-2"
                />
                <span className="text-muted-foreground">s over</span>
                <Input
                  type="number"
                  min={1}
                  value={v.frameWindow ?? 2}
                  onChange={(e) =>
                    onWindowChange({
                      frameWindow: Math.max(1, Number(e.target.value) || 2),
                    })
                  }
                  className="glass border-white/10 h-7 w-16 text-[11px] px-2"
                />
                <span className="text-muted-foreground">
                  s{v.durationSeconds ? ` (clip is ${v.durationSeconds}s)` : ""}
                </span>
                <Button
                  onClick={onReextract}
                  disabled={v.extracting}
                  size="sm"
                  variant="outline"
                  className="h-7 text-[11px] border-white/10 gap-1.5"
                >
                  {v.extracting ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Film className="h-3 w-3" />
                  )}
                  Re-extract
                </Button>
              </div>

              <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
                {v.frames.map((f, i) => (
                  <button
                    key={i}
                    onClick={() => onSelectFrame(i)}
                    className={`relative aspect-[3/4] rounded-lg overflow-hidden border-2 transition-all ${
                      v.selectedFrame === i
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

            {/* generate controls */}
            {v.selectedFrame !== null && (
              <div className="flex items-center gap-2 flex-wrap">
                <div className="flex items-center gap-1 text-sm">
                  <span className="text-muted-foreground text-xs">stills</span>
                  <button onClick={() => onBatchSize(Math.max(1, v.batchSize - 1))} className="h-6 w-6 rounded-md hover:bg-white/10">−</button>
                  <span className="w-5 text-center">{v.batchSize}</span>
                  <button onClick={() => onBatchSize(Math.min(4, v.batchSize + 1))} className="h-6 w-6 rounded-md hover:bg-white/10">+</button>
                </div>
                <Button
                  onClick={onGenerate}
                  disabled={v.writing || stillActive}
                  size="sm"
                  className="rounded-xl bg-[oklch(0.75_0.15_270)] hover:bg-[oklch(0.7_0.15_270)] text-white gap-2"
                >
                  {v.writing || stillActive ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                  {v.stillJobs.length ? "Regenerate" : "Recreate Still"}
                </Button>
              </div>
            )}

            {/* editable prompt */}
            {v.recreationPrompt && (
              <Textarea
                value={v.recreationPrompt}
                onChange={(e) => onPromptChange(e.target.value)}
                rows={3}
                className="glass border-white/10 resize-none text-[11px] font-mono"
              />
            )}
          </div>
        </div>

        {/* stills */}
        {v.stillJobs.length > 0 && (
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
                        onClick={() => onApprove(job.outputPath!)}
                        size="sm"
                        className="flex-1 h-7 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white gap-1 text-xs"
                      >
                        <ThumbsUp className="h-3 w-3" /> Use
                      </Button>
                      <Button onClick={() => onReject(job.id)} size="sm" variant="outline" className="h-7 rounded-lg border-white/10 px-2">
                        <ThumbsDown className="h-3 w-3" />
                      </Button>
                      <Button
                        onClick={() => onPostProcess(job.id, job.outputPath!)}
                        size="sm"
                        variant="outline"
                        title="Post-process: edit this image with Nano Banana"
                        className="h-7 rounded-lg border-white/10 px-2"
                      >
                        <Brush className="h-3 w-3" />
                      </Button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
