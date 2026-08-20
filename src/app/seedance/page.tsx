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
  Scissors,
  Brush,
  Bookmark,
  Star,
  Users,
  X,
} from "lucide-react";
import {
  applyOverrides,
  describeButtSize,
  describeChestSize,
  describePromptBriefly,
  usefulCharacterProfile,
} from "@/lib/prompt-overrides";

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
  // Picked frames, stored as PATHS not indices — re-extracting from another
  // part of the clip replaces `frames` but must not invalidate what you already
  // picked, which is what makes "one frame from part 1, one from part 2" work.
  pickedFramePaths: string[];
  customFramePath: string | null; // user-uploaded frame, counts as another pick
  // Set when the video came from a saved prompt preset: its proven recreation
  // JSON, reused instead of paying for another Grok vision call. Identity,
  // outfit, hair, makeup and background are patched in at generate time.
  presetPrompt?: string;
  presetName?: string;
  // Frame-extraction window, so it can be re-run from any point in the clip.
  frameStart?: number;
  frameWindow?: number;
  extracting?: boolean;
  // Where the clip's two scenes divide, in seconds. Each shot is driven by the
  // segment its part names, not by the whole clip.
  splitAt?: number;
  // Per-frame styling overrides, keyed by frame path. Anything left blank
  // falls back to the batch-wide value, so the old "one look for everything"
  // flow still works by simply not touching these.
  frameStyles?: Record<string, FrameStyle>;
}

interface FrameStyle {
  outfit?: string;
  hair?: string;
  makeup?: string;
  chest?: string; // bust size; blank follows the batch value
  butt?: string; // butt size; blank follows the batch value
  // Body posture. Normally the frame IS the pose — this is for when the frame's
  // composition is right but the posture should be something else. Blank keeps
  // whatever the frame is doing, so the default flow is unchanged.
  pose?: string;
  // Which backdrop this shot uses. Tri-state, because "no override" and
  // "deliberately keep the video's own backdrop" are different answers:
  //   undefined → follow the batch-wide pick
  //   null      → keep this frame's own background
  //   number    → that saved background's frozen description
  backgroundId?: number | null;
  // Which engine animates this shot. Blank follows the batch default, so a
  // batch can be mostly Seedance with one Kling shot (or the reverse).
  engine?: "seedance" | "kling";
  // Hand-edited video prompt. Blank = use the default (the Seedance template,
  // or the Grok-written motion prompt for image-to-video).
  videoPrompt?: string;
  part?: 1 | 2; // which side of the split drives this shot
  seconds?: number; // output length; defaults to that segment's length
  // "video" (default) animates from the clip segment; "i2v" ignores the clip
  // and invents the motion from an action prompt instead.
  mode?: "video" | "i2v";
  action?: string; // the i2v action, refined by Grok into the motion prompt
}

// One-tap actions for image-to-video shots.
const I2V_ACTIONS = [
  {
    label: "Head tilt + smile",
    action: "gently tilting her head to one side and slightly smiling",
  },
  {
    label: "Selfie turn-around",
    action:
      "taking a selfie, making one single half turn at the waist to show her back to the camera, glancing back over her shoulder, then holding that pose — one half turn only, she never spins or rotates fully; the arm holding the phone travels with her body and keeps adjusting naturally, never locked in place",
  },
];

// A proven recreation prompt saved with the frame it was written from.
interface PromptPreset {
  id: number;
  name: string;
  prompt: string;
  thumbPath: string | null;
  videoPath: string | null;
  durationSeconds: number | null;
  notes: string | null;
}

// A reusable hairstyle / makeup / outfit option.
interface StylePreset {
  id: number;
  kind: "hair" | "makeup" | "outfit";
  name: string;
  description: string;
  isDefault: boolean;
}

// One (video × outfit) combination — its own still and video.
interface Variant {
  id: string;
  videoId: string;
  framePath: string; // which picked frame this variant recreates
  outfit: string;
  // Resolved at build time: the frame's own styling, else the batch default.
  hair: string;
  makeup: string;
  chest: string; // "" = leave the bust to the LoRA and the reference
  butt: string; // "" = leave the butt to the LoRA and the reference
  pose: string; // "" = keep the frame's own posture
  background: string; // frozen location text; "" = keep the frame's own
  part: 1 | 2; // which segment of the source clip drives this shot
  seconds?: number; // output length override
  mode: "video" | "i2v";
  engine: "seedance" | "kling";
  videoPrompt: string; // "" = use the engine's default prompt
  action?: string;
  recreationPrompt: string;
  writing: boolean;
  stillJobs: Job[];
  approvedStillPath: string | null;
  seedanceJob: Job | null;
}

type Step =
  | "setup"
  | "videos"
  | "background"
  | "style"
  | "outfits"
  | "stills"
  | "results";

const STEPS: {
  key: Step;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}[] = [
  { key: "setup", label: "Setup", icon: Wand2 },
  { key: "videos", label: "Videos", icon: Film },
  { key: "background", label: "Background", icon: ImagePlus },
  { key: "style", label: "Hair & Makeup", icon: Scissors },
  { key: "outfits", label: "Outfits", icon: Shirt },
  { key: "stills", label: "Stills", icon: Sparkles },
  { key: "results", label: "Seedance", icon: Clapperboard },
];

const fileUrl = (p: string) =>
  p.startsWith("http") ? p : `/api/files/${p.replace(/\\/g, "/")}`;
const uid = () => `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
// Every frame we recreate from: an uploaded one plus each picked extract.
const chosenFrames = (v: VideoItem): string[] => [
  ...(v.customFramePath ? [v.customFramePath] : []),
  ...(v.pickedFramePaths ?? []),
];
// First pick — used where a single representative frame is needed (thumbnails).
const chosenFrame = (v: VideoItem): string | null => chosenFrames(v)[0] ?? null;
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
  // Which engine animates the approved stills. Seedance is video-to-video with
  // a prompt; Kling 3 motion control transfers motion and takes no prompt.
  const [videoEngine, setVideoEngine] = useState<"seedance" | "kling">("seedance");
  // Subtle-motion prompt wording for casual selfie shots (Seedance only —
  // Kling's motion_control takes no prompt at all).
  const [naturalMotion, setNaturalMotion] = useState(true);
  // Batch default motion mode. Individual shots can still override it — the
  // Setup tile just decides what every shot starts as.
  const [defaultI2v, setDefaultI2v] = useState(false);
  // The movement every image-to-video shot performs unless overridden per shot.
  const [defaultAction, setDefaultAction] = useState(I2V_ACTIONS[0].action);
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

  // Saved prompt presets (proven pose/scene recipes) + hair/makeup options.
  const [promptPresets, setPromptPresets] = useState<PromptPreset[]>([]);
  const [stylePresets, setStylePresets] = useState<StylePreset[]>([]);
  const [hairText, setHairText] = useState("");
  const [makeupText, setMakeupText] = useState("");
  // Bust size for the whole batch; any shot can override it. Blank leaves the
  // character LoRA and the reference frame to decide, as before.
  // Which model writes the prompts (recreation JSON, background description,
  // image-to-video motion). Same prompts either way — only the writer changes.
  const [promptProvider, setPromptProvider] = useState<"grok" | "gemini">("grok");
  const [chestText, setChestText] = useState("");
  const [buttText, setButtText] = useState("");
  const [savingPreset, setSavingPreset] = useState<string | null>(null);
  // Which shot's video prompt is currently being fetched ("videoId:framePath").
  const [loadingVideoPrompt, setLoadingVideoPrompt] = useState<string | null>(null);

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
    const [charsRes, bgRes, promptRes, styleRes] = await Promise.all([
      fetch("/api/characters"),
      fetch("/api/backgrounds"),
      fetch("/api/prompt-presets"),
      fetch("/api/style-presets"),
    ]);
    setCharacters(await charsRes.json());
    setSavedBackgrounds(await bgRes.json());
    setPromptPresets(await promptRes.json());

    const styles: StylePreset[] = await styleRes.json();
    setStylePresets(styles);
    // Preselect whichever hair/makeup option is flagged default.
    const defHair = styles.find((s) => s.kind === "hair" && s.isDefault);
    const defMakeup = styles.find((s) => s.kind === "makeup" && s.isDefault);
    if (defHair) setHairText(defHair.description);
    if (defMakeup) setMakeupText(defMakeup.description);
  }, []);
  useEffect(() => {
    fetchInitialData();
  }, [fetchInitialData]);

  // ── Import handoff from the Instagram page ──
  // /seedance?import=<videoPath>&name=...&duration=... — the video is already
  // downloaded; just extract frames and drop it into the batch.
  const importedRef = useRef(false);
  useEffect(() => {
    if (importedRef.current) return;
    const sp = new URLSearchParams(window.location.search);
    const videoPath = sp.get("import");
    if (!videoPath) return;
    importedRef.current = true;
    const name = sp.get("name") || "instagram import";
    const durationSeconds = parseFloat(sp.get("duration") || "0") || 0;
    window.history.replaceState({}, "", window.location.pathname);
    (async () => {
      setIntaking(true);
      try {
        const fr = await fetch("/api/references/frames", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ videoPath, count: 10, seconds: 2 }),
        });
        const fd = await fr.json();
        if (fd.error) throw new Error(fd.error);
        setVideos((prev) => [
          ...prev,
          {
            id: uid(),
            name,
            videoPath,
            durationSeconds,
            frames: fd.frames || [],
            pickedFramePaths: [],
            customFramePath: null,
          },
        ]);
        toast.success(`Imported ${name} — it's waiting in the Videos step`);
      } catch (err: unknown) {
        toast.error(err instanceof Error ? err.message : "Import failed");
      } finally {
        setIntaking(false);
      }
    })();
  }, []);

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
          pickedFramePaths: [],
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

  // ── Prompt presets ──
  // Drop a saved recipe straight into the batch: its video and frame are
  // already known-good, and its prompt skips the Grok call entirely.
  const usePromptPreset = async (preset: PromptPreset) => {
    if (!preset.videoPath) {
      toast.error("This preset has no video attached");
      return;
    }
    setVideos((prev) => [
      ...prev,
      {
        id: uid(),
        name: preset.name,
        videoPath: preset.videoPath!,
        durationSeconds: preset.durationSeconds ?? 0,
        frames: [],
        pickedFramePaths: [],
        customFramePath: preset.thumbPath,
        presetPrompt: preset.prompt,
        presetName: preset.name,
      },
    ]);
    toast.success(`Added "${preset.name}" — prompt ready, just pick outfits`);
  };

  // Save a variant's working prompt as a reusable recipe.
  const savePromptPreset = async (v: Variant) => {
    const video = videos.find((x) => x.id === v.videoId);
    const prompt = v.recreationPrompt;
    if (!prompt.trim() || !video) {
      toast.error("Generate the still first so there's a prompt to save");
      return;
    }
    const suggested =
      describePromptBriefly(prompt) || video.name || "Recreation prompt";
    const name = window.prompt("Name this format:", suggested);
    if (!name?.trim()) return;

    setSavingPreset(v.id);
    try {
      const res = await fetch("/api/prompt-presets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          prompt,
          thumbPath: chosenFrame(video),
          videoPath: video.videoPath,
          durationSeconds: video.durationSeconds,
        }),
      });
      const row = await res.json();
      if (row.error) throw new Error(row.error);
      setPromptPresets((prev) => [row, ...prev]);
      toast.success(`Saved "${row.name}" to Formats`);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to save preset");
    } finally {
      setSavingPreset(null);
    }
  };

  const deletePromptPreset = async (id: number) => {
    await fetch(`/api/prompt-presets?id=${id}`, { method: "DELETE" });
    setPromptPresets((prev) => prev.filter((p) => p.id !== id));
  };

  // ── Outfit library ──
  // Same store as hair/makeup, but outfits are picked several at a time rather
  // than one-of, so there's no default and they add to the batch list.
  const savedOutfits = stylePresets.filter((p) => p.kind === "outfit");

  const saveOutfitPreset = async (description: string) => {
    const name = window.prompt(
      "Name this outfit:",
      description.slice(0, 40)
    );
    if (!name?.trim()) return;
    try {
      const res = await fetch("/api/style-presets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "outfit", name, description }),
      });
      const row = await res.json();
      if (row.error) throw new Error(row.error);
      setStylePresets((prev) => [row, ...prev]);
      toast.success(`Saved outfit "${row.name}"`);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to save outfit");
    }
  };

  // ── Style presets (hair / makeup) ──
  const saveStylePreset = async (kind: "hair" | "makeup") => {
    const description = (kind === "hair" ? hairText : makeupText).trim();
    if (!description) return;
    const name = window.prompt(`Name this ${kind} preset:`, description.slice(0, 40));
    if (!name?.trim()) return;
    try {
      const res = await fetch("/api/style-presets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, name, description }),
      });
      const row = await res.json();
      if (row.error) throw new Error(row.error);
      setStylePresets((prev) => [row, ...prev]);
      toast.success(`Saved ${kind} preset "${row.name}"`);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to save preset");
    }
  };

  const toggleStyleDefault = async (preset: StylePreset) => {
    const next = !preset.isDefault;
    const res = await fetch("/api/style-presets", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: preset.id, isDefault: next }),
    });
    const row = await res.json();
    if (row.error) return toast.error(row.error);
    setStylePresets((prev) =>
      prev.map((p) =>
        p.kind !== preset.kind
          ? p
          : p.id === row.id
            ? row
            : { ...p, isDefault: false }
      )
    );
  };

  const deleteStylePreset = async (id: number) => {
    await fetch(`/api/style-presets?id=${id}`, { method: "DELETE" });
    setStylePresets((prev) => prev.filter((p) => p.id !== id));
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
      // Picks are paths, so anything already chosen survives — that's how you
      // take one frame from part 1 and another from part 2 of the same clip.
      patchVideo(vid.id, { frames: data.frames, extracting: false });
      toast.success(
        `Frames from ${start}s–${start + windowSecs}s — earlier picks kept`
      );
    } catch (err: unknown) {
      patchVideo(vid.id, { extracting: false });
      toast.error(err instanceof Error ? err.message : "Re-extract failed");
    }
  };

  const addOutfit = () => {
    const t = newOutfit.trim();
    if (!t) return;
    setOutfits((prev) => [...prev, t]);
    setNewOutfit("");
  };

  // Build variants from the picked frames. A frame with its own outfit is a
  // single shot styled exactly as set; a frame left blank falls back to the
  // shared outfit list and multiplies across it, preserving the batch flow.
  const buildVariants = () => {
    const ready = videos.filter((v) => chosenFrames(v).length > 0);
    const next: Variant[] = [];
    for (const vid of ready) {
      for (const framePath of chosenFrames(vid)) {
        const style = vid.frameStyles?.[framePath] ?? {};
        // No override and no shared list → one shot that keeps whatever the
        // frame is already wearing (an empty outfit sends no override to Grok,
        // so it describes the clothing straight from the scene reference).
        const frameOutfits = style.outfit?.trim()
          ? [style.outfit.trim()]
          : outfits.length > 0
            ? outfits
            : [""];
        const hair = (style.hair ?? hairText) || "";
        const makeup = (style.makeup ?? makeupText) || "";
        const chest = (style.chest ?? chestText) || "";
        const butt = (style.butt ?? buttText) || "";
        // Per-frame only — there is no batch-wide pose, because every frame
        // already carries its own.
        const pose = style.pose?.trim() || "";
        const part = style.part ?? 1;
        const mode = style.mode ?? (defaultI2v ? "i2v" : "video");
        // Kling needs a driving clip, so an image-to-video shot always runs on
        // Seedance no matter what the shot (or the batch) asked for.
        const engine =
          mode === "i2v" ? "seedance" : (style.engine ?? videoEngine);
        const videoPrompt = style.videoPrompt?.trim() || "";
        // Undefined means "no answer given" → inherit the batch pick; null is a
        // deliberate "keep this frame's own backdrop".
        const background =
          style.backgroundId === undefined
            ? bgDescription.trim()
            : style.backgroundId === null
              ? ""
              : (savedBackgrounds.find((b) => b.id === style.backgroundId)
                  ?.description ?? "");
        const action = style.action?.trim() || defaultAction.trim() || I2V_ACTIONS[0].action;

        for (const outfit of frameOutfits) {
          const existing = variants.find(
            (x) =>
              x.videoId === vid.id &&
              x.outfit === outfit &&
              x.framePath === framePath
          );
          next.push(
            existing
              ? {
                  ...existing,
                  hair,
                  makeup,
                  chest,
                  butt,
                  pose,
                  background,
                  part,
                  seconds: style.seconds,
                  mode,
                  engine,
                  videoPrompt,
                  action,
                }
              : {
                  id: uid(),
                  videoId: vid.id,
                  framePath,
                  outfit,
                  hair,
                  makeup,
                  chest,
                  butt,
                  pose,
                  background,
                  part,
                  seconds: style.seconds,
                  mode,
                  engine,
                  videoPrompt,
                  action,
                  recreationPrompt: "",
                  writing: false,
                  stillJobs: [],
                  approvedStillPath: null,
                  seedanceJob: null,
                }
          );
        }
      }
    }
    setVariants(next);
    setStep("stills");
  };

  // Patch one frame's styling override.
  const patchFrameStyle = (
    videoId: string,
    framePath: string,
    patch: Partial<FrameStyle>
  ) => {
    setVideos((prev) =>
      prev.map((v) =>
        v.id !== videoId
          ? v
          : {
              ...v,
              frameStyles: {
                ...(v.frameStyles ?? {}),
                [framePath]: { ...(v.frameStyles?.[framePath] ?? {}), ...patch },
              },
            }
      )
    );
  };

  // Pull the prompt this shot WOULD run with into its box, so it can be read
  // and edited instead of taken on trust. Same two sources generateSeedance
  // uses: the static template for clip-driven shots, Grok for image-to-video.
  const loadDefaultVideoPrompt = async (
    videoId: string,
    framePath: string,
    mode: "video" | "i2v",
    action: string
  ) => {
    setLoadingVideoPrompt(`${videoId}:${framePath}`);
    try {
      const res = await fetch(
        mode === "i2v" ? "/api/grok/seedance-motion" : "/api/grok/seedance-prompt",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            mode === "i2v"
              ? { action, provider: promptProvider }
              : { natural: naturalMotion }
          ),
        }
      );
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      patchFrameStyle(videoId, framePath, { videoPrompt: data.prompt });
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Could not load the prompt");
    } finally {
      setLoadingVideoPrompt(null);
    }
  };

  // ── Stills ──

  // Write the recreation prompt for a shot WITHOUT submitting it. Split out of
  // generateStill so the prompt can be read, edited and saved before any
  // credits are spent on rendering it.
  const buildPrompt = async (v: Variant): Promise<string> => {
    if (!selectedCharacter?.baseImagePath) {
      throw new Error(`${selectedCharacter?.name} has no face reference image.`);
    }
    const origin = window.location.origin;
    const sceneRefUrl = `${origin}${fileUrl(v.framePath)}`;
    const faceRefUrl = selectedCharacter.baseImagePath.startsWith("http")
      ? selectedCharacter.baseImagePath
      : `${origin}${fileUrl(selectedCharacter.baseImagePath)}`;

    let prompt: string;
    const video = videos.find((x) => x.id === v.videoId);
    if (video?.presetPrompt) {
      // Baked-in prompt: the pose, camera, lighting and composition are
      // already proven, so no Grok call. Only the identity and the
      // wardrobe/styling get patched in.
      prompt = applyOverrides(video.presetPrompt, {
        characterName: selectedCharacter.name,
        characterProfile: selectedCharacter.featureProfile,
        outfit: v.outfit,
        // Per-variant, so two frames from one clip can wear different looks.
        hair: v.hair,
        makeup: v.makeup,
        chest: v.chest || undefined,
        butt: v.butt || undefined,
        // No size given → drop the frame's build so the LoRA supplies it.
        bodyFromLora: !v.chest.trim() && !v.butt.trim(),
        // Blank leaves the preset's proven posture untouched.
        pose: v.pose || undefined,
        background: v.background || undefined,
      });
    } else {
      const pr = await fetch("/api/grok/swap-prompt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sceneRefUrl,
          faceRefUrl,
          // Skips the import placeholder (a UUID tells the model nothing).
          settingDescription:
            usefulCharacterProfile(selectedCharacter.featureProfile) || undefined,
          characterName: selectedCharacter.name,
          outfitOverride: v.outfit,
          // Grok fills the structured pose fields from this instead of
          // reading the posture off the frame.
          poseOverride: v.pose || undefined,
          // The frozen background text becomes the scene's environment —
          // used verbatim so every still renders the same room.
          backgroundDescription: v.background || undefined,
          provider: promptProvider,
        }),
      });
      const pd = await pr.json();
      if (pd.error) throw new Error(pd.error);
      // Hair/makeup/body aren't in the Grok template — patch them in. Always
      // run: with no size given, this is what strips the body Grok read off
      // the frame so the LoRA decides it instead.
      prompt = applyOverrides(pd.prompt, {
        hair: v.hair,
        makeup: v.makeup,
        chest: v.chest || undefined,
        butt: v.butt || undefined,
        bodyFromLora: !v.chest.trim() && !v.butt.trim(),
      });
    }

    // Keep the prompt's own output block in agreement with the provider param.
    try {
      const parsed = JSON.parse(prompt);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        parsed.output = {
          ...(parsed.output ?? {}),
          ratio: aspectRatio,
          orientation:
            aspectRatio === "16:9"
              ? "Landscape"
              : aspectRatio === "1:1"
                ? "Square"
                : "Portrait",
        };
        prompt = JSON.stringify(parsed, null, 2);
      }
    } catch {
      // plain-text prompt — nothing to align
    }
    return prompt;
  };

  const generateStill = async (v: Variant) => {
    const vid = videos.find((x) => x.id === v.videoId);
    const frame = v.framePath;
    if (!vid || !frame || !selectedCharacter) return;
    if (!selectedCharacter.baseImagePath) {
      toast.error(`${selectedCharacter.name} has no face reference image.`);
      return;
    }
    patchVariant(v.id, { writing: true });
    try {
      // An edited prompt wins — only write a fresh one when the box is empty.
      const prompt = v.recreationPrompt.trim() || (await buildPrompt(v));
      // Recorded on the job so the still can be traced back to the frame it
      // recreates (soul_2 doesn't consume it as a reference image).
      const sceneRefUrl = `${window.location.origin}${fileUrl(frame)}`;

      const res = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "image",
          prompt,
          provider: "higgsfield",
          providerModel: "soul_2",
          // Same ratio as the final video — a 3:4 still stretched into a
          // 9:16 frame is what makes the output look squeezed.
          providerParams: { quality: "2k", aspectRatio, sceneRefUrl },
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

  // Send a finished still through nano-banana with an edit instruction. The
  // result lands in the same card as another candidate, so "Use" works on it
  // like any other still.
  const postProcessStill = async (v: Variant, job: Job) => {
    if (!job.outputPath) return;
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
          providerParams: {
            aspectRatio,
            // The generated still rides along as the image being edited.
            mediaRefs: [job.outputPath],
          },
          characterId: selectedCharacter?.id,
        }),
      });
      const newJob = await res.json();
      if (newJob.error) throw new Error(newJob.error);
      patchVariant(v.id, { stillJobs: [...v.stillJobs, newJob] });
      toast.success("Post-process queued — the edit appears as a new candidate");
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Post-process failed");
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
        body: JSON.stringify({ imageUrl: r.imageUrl, provider: promptProvider }),
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
        body: JSON.stringify({ natural: naturalMotion }),
      });
      const pd = await pr.json();
      if (pd.error) throw new Error(pd.error);
      const prompt = pd.prompt;

      // Cut each clip's parts once and reuse across its shots — trimming is
      // ffmpeg work, no need to repeat it per outfit.
      const segmentCache = new Map<string, { path: string; seconds: number }>();
      const segmentFor = async (vid: VideoItem, part: 1 | 2) => {
        const split = vid.splitAt;
        // No split set → the whole clip drives every shot, as before.
        if (!split || split <= 0 || split >= vid.durationSeconds) {
          return { path: vid.videoPath, seconds: vid.durationSeconds };
        }
        const key = `${vid.id}:${part}`;
        const hit = segmentCache.get(key);
        if (hit) return hit;
        const body =
          part === 1
            ? { videoPath: vid.videoPath, start: 0, end: split }
            : { videoPath: vid.videoPath, start: split };
        const res = await fetch("/api/references/trim", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const data = await res.json();
        if (data.error) throw new Error(`Split failed: ${data.error}`);
        const seg = {
          path: data.videoPath as string,
          seconds: (data.durationSeconds as number) || 0,
        };
        segmentCache.set(key, seg);
        return seg;
      };

      // Image-to-video shots get their motion prompt written by Grok from the
      // shot's action — cached per action so identical actions cost one call.
      const motionPromptCache = new Map<string, string>();
      const motionPromptFor = async (action: string) => {
        const hit = motionPromptCache.get(action);
        if (hit) return hit;
        const res = await fetch("/api/grok/seedance-motion", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action, provider: promptProvider }),
        });
        const data = await res.json();
        if (data.error) throw new Error(`Motion prompt failed: ${data.error}`);
        motionPromptCache.set(action, data.prompt);
        return data.prompt as string;
      };

      for (const v of ready) {
        const vid = videos.find((x) => x.id === v.videoId);
        if (!vid) continue;
        const isI2v = v.mode === "i2v";
        // Kling has no promptable image-to-video — i2v shots always run on
        // Seedance, which buildVariants already forced when resolving `engine`.
        const seg = isI2v ? null : await segmentFor(vid, v.part);
        // A hand-edited prompt wins over the generated default.
        const shotPrompt =
          v.videoPrompt.trim() ||
          (isI2v ? await motionPromptFor(v.action || "") : prompt);
        const res = await fetch("/api/seedance", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            imagePath: v.approvedStillPath,
            ...(seg ? { videoPath: seg.path } : {}),
            prompt: shotPrompt,
            duration: v.seconds || seg?.seconds || (isI2v ? 5 : undefined),
            aspectRatio,
            characterId: selectedCharacter?.id,
            outfit: v.outfit,
            provider: videoProvider,
            fast: kieFast,
            // "kling" routes to Higgsfield motion_control instead of Seedance.
            // Resolved per shot, so one clip can produce both in a single batch.
            engine: v.engine,
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
  const framedVideos = videos.filter((v) => chosenFrames(v).length > 0).length;
  // Total picked frames across the batch — the real multiplier for variants,
  // since a clip can contribute several poses.
  const pickedFrames = videos.reduce((n, v) => n + chosenFrames(v).length, 0);
  // A frame with its own outfit is one shot; a blank one multiplies across the
  // shared outfit list. This is the true number of stills the batch will make.
  const plannedVariants = videos.reduce(
    (n, v) =>
      n +
      chosenFrames(v).reduce(
        (m, f) =>
          m +
          (v.frameStyles?.[f]?.outfit?.trim()
            ? 1
            : Math.max(1, outfits.length)),
        0
      ),
    0
  );

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
      patchVideo(videoId, { customFramePath: r.path });
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
              {/* Which model writes the prompts. Both read the same reference
                  images and follow the same system prompts. */}
              <div>
                <p className="text-[11px] text-muted-foreground mb-1.5">Prompt writer</p>
                <div className="flex gap-2 flex-wrap">
                  {(
                    [
                      { id: "grok" as const, label: "Grok", sub: "x.ai · grok-4.3" },
                      { id: "gemini" as const, label: "Gemini", sub: "Google · gemini-3.5-flash" },
                    ]
                  ).map((p) => (
                    <button
                      key={p.id}
                      onClick={() => setPromptProvider(p.id)}
                      className={`text-left p-2.5 rounded-xl transition-all min-w-[170px] ${
                        promptProvider === p.id
                          ? "glass-strong border-[oklch(0.75_0.15_270_/_30%)]"
                          : "glass hover:bg-white/5"
                      }`}
                    >
                      <span className="font-medium text-xs">{p.label}</span>
                      <p className="text-[10px] text-muted-foreground/60 mt-0.5">{p.sub}</p>
                    </button>
                  ))}
                </div>
              </div>

              {/* Motion engine — both drive the still with a reference clip. */}
              <div>
                <p className="text-[11px] text-muted-foreground mb-1.5">Motion engine</p>
                <div className="flex gap-2 flex-wrap">
                  {(
                    [
                      { id: "seedance" as const, i2v: false, label: "Seedance 2.0", sub: "prompt-driven video-to-video" },
                      { id: "kling" as const, i2v: false, label: "Kling Motion", sub: "motion transfer · no prompt" },
                      { id: "seedance" as const, i2v: true, label: "Image to Video", sub: "Seedance · no clip — motion from an action prompt" },
                    ]
                  ).map((e) => {
                    const active = e.i2v ? defaultI2v : !defaultI2v && videoEngine === e.id;
                    return (
                    <button
                      key={e.label}
                      onClick={() => {
                        setVideoEngine(e.id);
                        setDefaultI2v(e.i2v);
                      }}
                      className={`text-left p-2.5 rounded-xl transition-all min-w-[170px] ${
                        active
                          ? "glass-strong border-[oklch(0.75_0.15_270_/_30%)]"
                          : "glass hover:bg-white/5"
                      }`}
                    >
                      <span className="font-medium text-xs">{e.label}</span>
                      <p className="text-[10px] text-muted-foreground/60 mt-0.5">{e.sub}</p>
                    </button>
                    );
                  })}
                </div>
                {defaultI2v && (
                  <div className="mt-2.5 space-y-1.5">
                    <p className="text-[11px] text-muted-foreground">
                      Movement — what the subject does (Grok refines it into a
                      handheld natural-motion prompt):
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {I2V_ACTIONS.map((a) => (
                        <button
                          key={a.label}
                          onClick={() => setDefaultAction(a.action)}
                          className={`px-2 py-1 rounded-lg text-xs border transition-colors ${
                            defaultAction === a.action
                              ? "bg-[oklch(0.75_0.15_270_/_20%)] border-white/20"
                              : "glass border-white/10 hover:bg-white/5"
                          }`}
                          title={a.action}
                        >
                          {a.label}
                        </button>
                      ))}
                    </div>
                    <Input
                      value={defaultAction}
                      onChange={(e) => setDefaultAction(e.target.value)}
                      placeholder="or describe the movement yourself"
                      className="glass border-white/10 h-8 text-xs"
                    />
                    <p className="text-[10px] text-muted-foreground">
                      Applies to every shot — any single shot can pick a
                      different movement (or &quot;from clip&quot;) in the
                      Outfits step.
                    </p>
                  </div>
                )}
                {!defaultI2v && videoEngine === "seedance" && (
                  <label className="flex items-center gap-2 mt-2 text-[11px] text-muted-foreground cursor-pointer">
                    <input
                      type="checkbox"
                      checked={naturalMotion}
                      onChange={(e) => setNaturalMotion(e.target.checked)}
                      className="accent-[oklch(0.75_0.15_270)]"
                    />
                    Subtle motion prompt — gentle head tilt, slight smile, handheld
                    selfie framing (best for casual clips)
                  </label>
                )}
              </div>

              <div className={videoEngine === "kling" ? "opacity-40 pointer-events-none" : ""}>
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
          {/* ── Saved prompt presets ──
              Proven pose/scene recipes. Picking one drops in its video with the
              prompt already attached, so no Grok call and no frame-picking. */}
          {promptPresets.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Bookmark className="h-4 w-4 text-[oklch(0.75_0.15_270)]" />
                  Formats
                  <Badge className="bg-white/10 text-[10px]">
                    {promptPresets.length}
                  </Badge>
                </CardTitle>
                <p className="text-xs text-muted-foreground mt-1">
                  Known-good shots. Click one to add its video with the prompt
                  ready — then just pick outfits.
                </p>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
                  {promptPresets.map((p) => (
                    <div
                      key={p.id}
                      className="group relative aspect-[3/4] rounded-xl overflow-hidden glass border border-white/10"
                    >
                      {p.thumbPath ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={fileUrl(p.thumbPath)}
                          alt={p.name}
                          loading="lazy"
                          className="absolute inset-0 w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                        />
                      ) : (
                        <div className="absolute inset-0 flex items-center justify-center text-muted-foreground">
                          <Sparkles className="h-6 w-6" />
                        </div>
                      )}

                      <button
                        onClick={() => deletePromptPreset(p.id)}
                        className="absolute top-1.5 right-1.5 h-6 w-6 rounded-md bg-black/60 backdrop-blur flex items-center justify-center text-white/70 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
                        title="Delete preset"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>

                      <div className="absolute bottom-0 inset-x-0 p-2 bg-gradient-to-t from-black/85 via-black/50 to-transparent space-y-1.5">
                        <p
                          className="text-[11px] font-medium text-white truncate"
                          title={p.name}
                        >
                          {p.name}
                        </p>
                        <Button
                          size="sm"
                          onClick={() => usePromptPreset(p)}
                          disabled={!p.videoPath}
                          className="w-full h-7 text-[11px] bg-[oklch(0.75_0.15_270_/_30%)] hover:bg-[oklch(0.75_0.15_270_/_50%)] text-white border border-white/10"
                        >
                          {p.videoPath ? "Use" : "No video"}
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

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
              <Card key={vid.id} className={chosenFrames(vid).length > 0 ? "ring-1 ring-emerald-500/40" : ""}>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div className="min-w-0">
                      <CardTitle className="text-sm truncate">{vid.name}</CardTitle>
                      <p className="text-[11px] text-muted-foreground mt-0.5">
                        {vid.durationSeconds}s · animation length auto-matches
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {vid.presetPrompt && (
                        <Badge className="text-xs bg-[oklch(0.75_0.15_270_/_15%)] text-[oklch(0.85_0.12_270)] border-white/10 border gap-1">
                          <Bookmark className="h-3 w-3" /> Prompt ready
                        </Badge>
                      )}
                      {chosenFrames(vid).length > 0 && (
                        <Badge className="text-xs bg-emerald-500/10 text-emerald-400 border-emerald-500/20 border gap-1">
                          <CheckCircle2 className="h-3 w-3" />
                          {vid.presetPrompt
                            ? "Saved frame"
                            : `${chosenFrames(vid).length} frame${chosenFrames(vid).length === 1 ? "" : "s"} picked`}
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

                      {/* Seek the extraction window — the usable pose is often
                          well past the opening seconds. */}
                      <div className="flex items-center gap-2 flex-wrap mb-2 text-[11px]">
                        <span className="text-muted-foreground">From</span>
                        <Input
                          type="number"
                          min={0}
                          max={Math.max(0, Math.floor(vid.durationSeconds) - 1)}
                          value={vid.frameStart ?? 0}
                          onChange={(e) =>
                            patchVideo(vid.id, {
                              frameStart: Math.max(0, Number(e.target.value) || 0),
                            })
                          }
                          className="glass border-white/10 h-7 w-16 text-[11px] px-2"
                        />
                        <span className="text-muted-foreground">s over</span>
                        <Input
                          type="number"
                          min={1}
                          value={vid.frameWindow ?? 2}
                          onChange={(e) =>
                            patchVideo(vid.id, {
                              frameWindow: Math.max(1, Number(e.target.value) || 2),
                            })
                          }
                          className="glass border-white/10 h-7 w-16 text-[11px] px-2"
                        />
                        <span className="text-muted-foreground">
                          s{vid.durationSeconds ? ` (clip is ${vid.durationSeconds}s)` : ""}
                        </span>
                        <Button
                          onClick={() => reextractFrames(vid)}
                          disabled={vid.extracting}
                          size="sm"
                          variant="outline"
                          className="h-7 text-[11px] border-white/10 gap-1.5"
                        >
                          {vid.extracting ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <Film className="h-3 w-3" />
                          )}
                          Re-extract
                        </Button>
                      </div>

                      {/* Two scenes in one clip: split it, and each shot is
                          driven by its own half rather than the whole thing. */}
                      <div className="flex items-center gap-2 flex-wrap mb-2 text-[11px]">
                        <Scissors className="h-3 w-3 text-muted-foreground" />
                        <span className="text-muted-foreground">Split scenes at</span>
                        <Input
                          type="number"
                          min={0}
                          max={Math.max(0, Math.floor(vid.durationSeconds) - 1)}
                          value={vid.splitAt ?? ""}
                          onChange={(e) =>
                            patchVideo(vid.id, {
                              splitAt: e.target.value
                                ? Math.max(0, Number(e.target.value) || 0)
                                : undefined,
                            })
                          }
                          placeholder="off"
                          className="glass border-white/10 h-7 w-16 text-[11px] px-2"
                        />
                        <span className="text-muted-foreground">
                          {vid.splitAt && vid.splitAt > 0 && vid.splitAt < vid.durationSeconds
                            ? `s — part 1 = 0–${vid.splitAt}s, part 2 = ${vid.splitAt}–${vid.durationSeconds}s`
                            : "s — off: every shot uses the whole clip"}
                        </span>
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
                        {vid.frames.map((f, i) => {
                          const picks = vid.pickedFramePaths ?? [];
                          const order = picks.indexOf(f);
                          const picked = order !== -1;
                          return (
                          <button
                            key={i}
                            onClick={() =>
                              patchVideo(vid.id, {
                                pickedFramePaths: picked
                                  ? picks.filter((x) => x !== f)
                                  : [...picks, f],
                              })
                            }
                            title={picked ? "Picked — click to remove" : "Pick this frame"}
                            className={`relative aspect-[3/4] rounded-lg overflow-hidden border-2 transition-all ${
                              picked
                                ? "border-[oklch(0.75_0.15_270)]"
                                : "border-transparent hover:border-white/20"
                            }`}
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={fileUrl(f)} alt={`f${i + 1}`} className="w-full h-full object-cover" loading="lazy" />
                            {picked && (
                              <span className="absolute top-1 right-1 h-4 w-4 rounded-full bg-[oklch(0.75_0.15_270)] text-white text-[9px] font-semibold flex items-center justify-center">
                                {order + 1}
                              </span>
                            )}
                          </button>
                          );
                        })}
                      </div>

                    </div>
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </div>
      )}

      {/* ── Hair & Makeup ── */}
      {/* Shared across the whole batch, like the background — unlike outfits,
          these don't multiply the variant matrix. */}
      {step === "style" && (
        <div className="space-y-4">
          {(["hair", "makeup"] as const).map((kind) => {
            const Icon = kind === "hair" ? Scissors : Brush;
            const value = kind === "hair" ? hairText : makeupText;
            const setValue = kind === "hair" ? setHairText : setMakeupText;
            const mine = stylePresets.filter((p) => p.kind === kind);
            return (
              <Card key={kind}>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle className="text-base flex items-center gap-2 capitalize">
                        <Icon className="h-4 w-4" /> {kind}
                      </CardTitle>
                      <p className="text-xs text-muted-foreground mt-1">
                        {kind === "hair"
                          ? "Style only — the colour comes from the character LoRA, so colour words are stripped."
                          : "Applied to every shot that has no override below."}
                      </p>
                    </div>
                    {value.trim() && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => saveStylePreset(kind)}
                        className="glass border-white/10 gap-1.5 text-xs"
                      >
                        <Bookmark className="h-3.5 w-3.5" /> Save preset
                      </Button>
                    )}
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <Textarea
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    placeholder={
                      kind === "hair"
                        ? "e.g. long loose beach waves, centre part, slightly tousled"
                        : "e.g. soft glam, warm bronze eye, glossy nude lip, dewy skin"
                    }
                    rows={2}
                    className="glass border-white/10 text-sm"
                  />

                  {mine.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {mine.map((p) => {
                        const active = value.trim() === p.description.trim();
                        return (
                          <div
                            key={p.id}
                            className={`group flex items-center gap-1.5 rounded-lg border px-2 py-1.5 transition-colors ${
                              active
                                ? "bg-[oklch(0.75_0.15_270_/_20%)] border-white/20"
                                : "glass border-white/10 hover:bg-white/5"
                            }`}
                          >
                            <button
                              onClick={() => setValue(p.description)}
                              className="text-xs text-left max-w-[220px] truncate"
                              title={p.description}
                            >
                              {p.name}
                            </button>
                            <button
                              onClick={() => toggleStyleDefault(p)}
                              title={p.isDefault ? "Default — click to unset" : "Make default"}
                              className={
                                p.isDefault
                                  ? "text-amber-400"
                                  : "text-muted-foreground/40 hover:text-amber-400"
                              }
                            >
                              <Star
                                className="h-3 w-3"
                                fill={p.isDefault ? "currentColor" : "none"}
                              />
                            </button>
                            <button
                              onClick={() => deleteStylePreset(p.id)}
                              className="text-muted-foreground/40 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
                              title="Delete preset"
                            >
                              <X className="h-3 w-3" />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {value.trim() && (
                    <button
                      onClick={() => setValue("")}
                      className="text-xs text-muted-foreground hover:text-foreground"
                    >
                      Clear {kind}
                    </button>
                  )}
                </CardContent>
              </Card>
            );
          })}

          {/* Body — the operator just types a size. Only the named part is
              rewritten: build, waist, hips and height are left exactly as the
              reference described them. */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Users className="h-4 w-4" /> Body
              </CardTitle>
              <p className="text-xs text-muted-foreground mt-1">
                Optional. Blank leaves that part to the character and the reference
                frame. Nothing else about the body is changed.
              </p>
            </CardHeader>
            <CardContent className="grid sm:grid-cols-2 gap-4">
              <div className="space-y-1">
                <label className="text-[11px] text-muted-foreground">Chest size</label>
                <Input
                  value={chestText}
                  onChange={(e) => setChestText(e.target.value)}
                  placeholder="e.g. 34C, DD, or petite"
                  className="glass border-white/10"
                />
                {chestText.trim() && (
                  <p className="text-[10px] text-muted-foreground">
                    In the prompt: <strong>{describeChestSize(chestText)}</strong>
                  </p>
                )}
              </div>
              <div className="space-y-1">
                <label className="text-[11px] text-muted-foreground">Butt size</label>
                <Input
                  value={buttText}
                  onChange={(e) => setButtText(e.target.value)}
                  placeholder="e.g. full and round, small"
                  className="glass border-white/10"
                />
                {buttText.trim() && (
                  <p className="text-[10px] text-muted-foreground">
                    In the prompt: <strong>{describeButtSize(buttText)}</strong>
                  </p>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Per-shot overrides. The cards above set the batch look; here you
              can give an individual frame something different. */}
          {pickedFrames > 1 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Per shot (optional)</CardTitle>
                <p className="text-xs text-muted-foreground mt-1">
                  Leave blank to use the batch hair, makeup &amp; body sizes above.
                </p>
              </CardHeader>
              <CardContent className="space-y-2">
                {videos.flatMap((vid) =>
                  chosenFrames(vid).map((framePath, idx) => {
                    const style = vid.frameStyles?.[framePath] ?? {};
                    const set = (patch: Partial<FrameStyle>) =>
                      patchFrameStyle(vid.id, framePath, patch);
                    return (
                      <div
                        key={`${vid.id}:${framePath}`}
                        className="flex gap-3 p-2.5 rounded-xl glass items-center"
                      >
                        <div className="relative shrink-0">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={fileUrl(framePath)}
                            alt={`shot ${idx + 1}`}
                            className="w-14 aspect-[3/4] rounded-lg object-cover border border-white/10"
                          />
                          <span className="absolute -top-1 -left-1 h-4 w-4 rounded-full bg-[oklch(0.75_0.15_270)] text-white text-[9px] font-semibold flex items-center justify-center">
                            {idx + 1}
                          </span>
                        </div>
                        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-2 flex-1 min-w-0">
                          <Input
                            value={style.hair ?? ""}
                            onChange={(e) => set({ hair: e.target.value })}
                            placeholder={
                              hairText ? `Hair — blank = "${hairText.slice(0, 20)}…"` : "Hair"
                            }
                            className="glass border-white/10 h-8 text-xs"
                          />
                          <Input
                            value={style.makeup ?? ""}
                            onChange={(e) => set({ makeup: e.target.value })}
                            placeholder={
                              makeupText
                                ? `Makeup — blank = "${makeupText.slice(0, 18)}…"`
                                : "Makeup"
                            }
                            className="glass border-white/10 h-8 text-xs"
                          />
                          <Input
                            value={style.chest ?? ""}
                            onChange={(e) => set({ chest: e.target.value })}
                            placeholder={
                              chestText ? `Chest — blank = "${chestText}"` : "Chest size"
                            }
                            className="glass border-white/10 h-8 text-xs"
                          />
                          <Input
                            value={style.butt ?? ""}
                            onChange={(e) => set({ butt: e.target.value })}
                            placeholder={
                              buttText ? `Butt — blank = "${buttText}"` : "Butt size"
                            }
                            className="glass border-white/10 h-8 text-xs"
                          />
                        </div>
                      </div>
                    );
                  })
                )}
              </CardContent>
            </Card>
          )}

          <div className="flex justify-end">
            <Button
              onClick={() => setStep("outfits")}
              className="rounded-xl bg-[oklch(0.75_0.15_270)] hover:bg-[oklch(0.7_0.15_270)] text-white gap-2"
            >
              Next: Outfits
            </Button>
          </div>
        </div>
      )}

      {/* ── Outfits ── */}
      {step === "outfits" && (
        <div className="space-y-4">

        {/* Per-shot: which outfit each picked frame wears, which half of the
            clip drives it, and how long it runs. */}
        {pickedFrames > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                Per shot ({pickedFrames})
              </CardTitle>
              <p className="text-xs text-muted-foreground mt-1">
                Give a frame its own outfit, or leave it blank to use the shared
                list below (which multiplies across every blank frame). Set a
                pose to keep the frame&apos;s composition but change the posture.
              </p>
            </CardHeader>
            <CardContent className="space-y-2">
              {videos.flatMap((vid) =>
                chosenFrames(vid).map((framePath, idx) => {
                  const style = vid.frameStyles?.[framePath] ?? {};
                  const set = (patch: Partial<FrameStyle>) =>
                    patchFrameStyle(vid.id, framePath, patch);
                  const hasSplit =
                    vid.splitAt != null &&
                    vid.splitAt > 0 &&
                    vid.splitAt < vid.durationSeconds;
                  // Same resolution buildVariants does, so the card shows what
                  // the shot will actually run as.
                  const mode = style.mode ?? (defaultI2v ? "i2v" : "video");
                  const engine =
                    mode === "i2v" ? "seedance" : (style.engine ?? videoEngine);
                  return (
                    <div
                      key={`${vid.id}:${framePath}`}
                      className="flex gap-3 p-2.5 rounded-xl glass"
                    >
                      <div className="relative shrink-0">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={fileUrl(framePath)}
                          alt={`shot ${idx + 1}`}
                          className="w-16 aspect-[3/4] rounded-lg object-cover border border-white/10"
                        />
                        <span className="absolute -top-1 -left-1 h-4 w-4 rounded-full bg-[oklch(0.75_0.15_270)] text-white text-[9px] font-semibold flex items-center justify-center">
                          {idx + 1}
                        </span>
                      </div>
                      <div className="flex-1 min-w-0 space-y-1.5">
                        <Input
                          value={style.outfit ?? ""}
                          onChange={(e) => set({ outfit: e.target.value })}
                          placeholder={
                            outfits.length
                              ? `Outfit — blank = all ${outfits.length} shared`
                              : "Outfit — blank = keep what's in the frame"
                          }
                          className="glass border-white/10 h-8 text-xs"
                        />
                        {savedOutfits.length > 0 && (
                          <div className="flex flex-wrap gap-1">
                            {savedOutfits.map((sp) => (
                              <button
                                key={sp.id}
                                onClick={() => set({ outfit: sp.description })}
                                className={`px-1.5 py-0.5 rounded text-[10px] border transition-colors truncate max-w-[160px] ${
                                  style.outfit === sp.description
                                    ? "bg-[oklch(0.75_0.15_270_/_25%)] border-white/20 text-white"
                                    : "bg-white/5 border-white/10 text-muted-foreground hover:text-foreground"
                                }`}
                                title={sp.description}
                              >
                                {sp.name}
                              </button>
                            ))}
                          </div>
                        )}
                        {/* Posture override. The frame normally supplies the
                            pose, so this is for keeping a frame's composition
                            while changing what the body is doing. */}
                        <Input
                          value={style.pose ?? ""}
                          onChange={(e) => set({ pose: e.target.value })}
                          placeholder="Pose — blank = keep the frame's own posture"
                          className="glass border-white/10 h-8 text-xs"
                        />
                        {/* How this shot moves: copy its clip segment, or
                            invent motion from an action prompt (image-to-video). */}
                        <div className="flex items-center gap-1.5 flex-wrap text-[10px]">
                          <span className="text-muted-foreground">motion</span>
                          {(
                            [
                              { m: "video" as const, label: "from clip" },
                              { m: "i2v" as const, label: "image to video" },
                            ]
                          ).map(({ m, label }) => (
                            <button
                              key={m}
                              onClick={() => set({ mode: m })}
                              className={`px-1.5 py-0.5 rounded border transition-colors ${
                                mode === m
                                  ? "bg-[oklch(0.75_0.15_270_/_25%)] border-white/20 text-white"
                                  : "bg-white/5 border-white/10 text-muted-foreground hover:text-foreground"
                              }`}
                            >
                              {label}
                            </button>
                          ))}
                          {/* Which engine animates THIS shot. Image-to-video is
                              Seedance-only (Kling needs a driving clip), so the
                              picker only appears for clip-driven shots. */}
                          {mode === "video" && (
                            <>
                              <span className="text-muted-foreground ml-1">engine</span>
                              {(
                                [
                                  { e: "seedance" as const, label: "Seedance" },
                                  { e: "kling" as const, label: "Kling Motion" },
                                ]
                              ).map(({ e, label }) => (
                                <button
                                  key={e}
                                  onClick={() => set({ engine: e })}
                                  className={`px-1.5 py-0.5 rounded border transition-colors ${
                                    engine === e
                                      ? "bg-[oklch(0.75_0.15_270_/_25%)] border-white/20 text-white"
                                      : "bg-white/5 border-white/10 text-muted-foreground hover:text-foreground"
                                  }`}
                                >
                                  {label}
                                </button>
                              ))}
                            </>
                          )}
                        </div>

                        {mode === "i2v" && (
                          <div className="space-y-1">
                            <div className="flex flex-wrap gap-1">
                              {I2V_ACTIONS.map((a) => (
                                <button
                                  key={a.label}
                                  onClick={() => set({ action: a.action })}
                                  className={`px-1.5 py-0.5 rounded text-[10px] border transition-colors ${
                                    (style.action ?? defaultAction) === a.action
                                      ? "bg-[oklch(0.75_0.15_270_/_25%)] border-white/20 text-white"
                                      : "bg-white/5 border-white/10 text-muted-foreground hover:text-foreground"
                                  }`}
                                >
                                  {a.label}
                                </button>
                              ))}
                            </div>
                            <Input
                              value={style.action ?? ""}
                              onChange={(e) => set({ action: e.target.value })}
                              placeholder={`Action — blank = "${(defaultAction || I2V_ACTIONS[0].action).slice(0, 34)}…"`}
                              className="glass border-white/10 h-7 text-[11px]"
                            />
                            <p className="text-[9px] text-muted-foreground">
                              Grok turns this into a handheld natural-motion prompt. Runs on Seedance (Kling needs a driving clip).
                            </p>
                          </div>
                        )}

                        {/* The prompt that drives the VIDEO. Kling's motion
                            control takes none, so this only shows on Seedance
                            shots. Blank = whatever the default would have been. */}
                        {engine === "seedance" && (
                          <div className="space-y-1">
                            <div className="flex items-center gap-1.5 text-[10px] flex-wrap">
                              <span className="text-muted-foreground">video prompt</span>
                              <button
                                onClick={() =>
                                  loadDefaultVideoPrompt(
                                    vid.id,
                                    framePath,
                                    mode,
                                    style.action ?? defaultAction
                                  )
                                }
                                disabled={
                                  loadingVideoPrompt === `${vid.id}:${framePath}`
                                }
                                className="px-1.5 py-0.5 rounded border bg-white/5 border-white/10 text-muted-foreground hover:text-foreground transition-colors inline-flex items-center gap-1"
                              >
                                {loadingVideoPrompt === `${vid.id}:${framePath}` && (
                                  <Loader2 className="h-2.5 w-2.5 animate-spin" />
                                )}
                                {mode === "i2v" ? "write from action" : "load template"}
                              </button>
                              {style.videoPrompt?.trim() && (
                                <button
                                  onClick={() => set({ videoPrompt: "" })}
                                  className="px-1.5 py-0.5 rounded border bg-white/5 border-white/10 text-muted-foreground hover:text-foreground transition-colors"
                                >
                                  reset to default
                                </button>
                              )}
                            </div>
                            <Textarea
                              value={style.videoPrompt ?? ""}
                              onChange={(e) => set({ videoPrompt: e.target.value })}
                              rows={3}
                              placeholder={
                                mode === "i2v"
                                  ? "blank = Grok writes it from the action above"
                                  : "blank = the standard Seedance motion template"
                              }
                              className="glass border-white/10 resize-none text-[11px]"
                            />
                          </div>
                        )}

                        <div className="flex items-center gap-1.5 flex-wrap text-[10px]">
                          {hasSplit && (style.mode ?? (defaultI2v ? "i2v" : "video")) === "video" && (
                            <>
                              <span className="text-muted-foreground">driven by</span>
                              {([1, 2] as const).map((n) => (
                                <button
                                  key={n}
                                  onClick={() => set({ part: n })}
                                  className={`px-1.5 py-0.5 rounded border transition-colors ${
                                    (style.part ?? 1) === n
                                      ? "bg-[oklch(0.75_0.15_270_/_25%)] border-white/20 text-white"
                                      : "bg-white/5 border-white/10 text-muted-foreground hover:text-foreground"
                                  }`}
                                >
                                  part {n}
                                </button>
                              ))}
                            </>
                          )}
                          <span className="text-muted-foreground ml-1">length</span>
                          <Input
                            type="number"
                            min={1}
                            max={15}
                            value={style.seconds ?? ""}
                            onChange={(e) =>
                              set({
                                seconds: e.target.value
                                  ? Math.max(1, Number(e.target.value) || 1)
                                  : undefined,
                              })
                            }
                            placeholder="auto"
                            className="glass border-white/10 h-6 w-14 text-[10px] px-1.5"
                          />
                          <span className="text-muted-foreground">s</span>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-base">Outfits</CardTitle>
                <p className="text-xs text-muted-foreground mt-1">
                  Optional. Applied to any shot you did not style individually — leave empty and each shot keeps the outfit already in its frame.{" "}
                  <strong>{plannedVariants}</strong> still{plannedVariants === 1 ? "" : "s"} / video{plannedVariants === 1 ? "" : "s"} total.
                </p>
              </div>
              {plannedVariants > 0 && (
                <Button
                  onClick={buildVariants}
                  className="rounded-xl bg-[oklch(0.75_0.15_270)] hover:bg-[oklch(0.7_0.15_270)] text-white gap-2"
                >
                  Next: Stills ({plannedVariants})
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
            {/* Saved outfit library — click to add to this batch */}
            {savedOutfits.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  Saved outfits
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {savedOutfits.map((p) => {
                    const added = outfits.includes(p.description);
                    return (
                      <div
                        key={p.id}
                        className={`group flex items-center gap-1.5 rounded-lg border px-2 py-1 transition-colors ${
                          added
                            ? "bg-[oklch(0.75_0.15_270_/_20%)] border-white/20"
                            : "glass border-white/10 hover:bg-white/5"
                        }`}
                      >
                        <button
                          onClick={() =>
                            setOutfits((prev) =>
                              added
                                ? prev.filter((o) => o !== p.description)
                                : [...prev, p.description]
                            )
                          }
                          className="text-xs text-left max-w-[240px] truncate"
                          title={p.description}
                        >
                          {p.name}
                        </button>
                        <button
                          onClick={() => deleteStylePreset(p.id)}
                          className="text-muted-foreground/40 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
                          title="Delete saved outfit"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {outfits.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">Add one or more outfits.</p>
            ) : (
              <div className="space-y-2">
                {outfits.map((o, i) => {
                  const isSaved = savedOutfits.some((p) => p.description === o);
                  return (
                  <div key={i} className="flex items-center gap-3 p-3 rounded-xl glass">
                    <Badge className="text-[10px] bg-white/5 border-white/10">{i + 1}</Badge>
                    <span className="text-sm flex-1">{o}</span>
                    {!isSaved && (
                      <button
                        onClick={() => saveOutfitPreset(o)}
                        className="h-7 px-2 rounded-md hover:bg-white/10 flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
                        title="Save to your outfit library"
                      >
                        <Bookmark className="h-3.5 w-3.5" /> Save
                      </button>
                    )}
                    <button
                      onClick={() => setOutfits((prev) => prev.filter((_, j) => j !== i))}
                      className="h-7 w-7 rounded-md hover:bg-red-500/20 flex items-center justify-center"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
        </div>
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
            .filter((vid) => chosenFrames(vid).length > 0)
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
                          <div className="flex items-center justify-between gap-2 flex-wrap">
                            <div className="flex items-center gap-2 min-w-0">
                              {/* which pose this variant recreates — several
                                  frames from one clip look alike otherwise */}
                              {v.framePath && (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                  src={fileUrl(v.framePath)}
                                  alt="source frame"
                                  className="h-9 w-7 rounded object-cover border border-white/10 shrink-0"
                                />
                              )}
                              <div className="min-w-0">
                                <CardTitle className="text-sm truncate">
                                  {v.outfit || "Frame's own outfit"}
                                </CardTitle>
                                <p className="text-[10px] text-muted-foreground truncate">
                                  {[
                                    v.hair,
                                    v.makeup,
                                    v.chest && describeChestSize(v.chest),
                                    v.butt && describeButtSize(v.butt),
                                    v.pose && `pose: ${v.pose}`,
                                    // Which engine and backdrop this shot
                                    // resolved to — both are per-shot now, so
                                    // the card has to say which it got.
                                    v.engine === "kling" ? "Kling Motion" : "Seedance",
                                    v.background ? "custom background" : "video's background",
                                  ]
                                    .filter(Boolean)
                                    .join(" · ")}
                                </p>
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              {/* Bank a prompt that worked so it can be reused
                                  on any character later. */}
                              {v.recreationPrompt.trim() && (
                                <Button
                                  onClick={() => savePromptPreset(v)}
                                  disabled={savingPreset === v.id}
                                  size="sm"
                                  variant="outline"
                                  className="rounded-xl border-white/10 gap-1.5 text-xs"
                                  title="Save this shot as a reusable format"
                                >
                                  {savingPreset === v.id ? (
                                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                  ) : (
                                    <Bookmark className="h-3.5 w-3.5" />
                                  )}
                                  Save prompt
                                </Button>
                              )}
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
                                        <Button
                                          onClick={() => postProcessStill(v, job)}
                                          size="sm"
                                          variant="outline"
                                          title="Post-process: edit this image with Nano Banana"
                                          className="h-7 rounded-lg border-white/10 px-2"
                                        >
                                          <Brush className="h-3 w-3" />
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
                  <CardTitle className='text-base'>Background</CardTitle>
                  <p className='text-xs text-muted-foreground mt-1'>
                    Defaults to the video&apos;s own backdrop. Pick a saved background to replace it — its
                    description is reused word-for-word, so the same room renders identically every time.
                    This is the batch default; any shot can override it below.
                  </p>
                </div>
                <Button
                  onClick={() => setStep('style')}
                  className='rounded-xl bg-[oklch(0.75_0.15_270)] hover:bg-[oklch(0.7_0.15_270)] text-white gap-2'
                >
                  {bgDescription.trim() ? 'Next: Hair & Makeup' : "Next — keep video's background"}
                  <Scissors className='h-4 w-4' />
                </Button>
              </div>
            </CardHeader>
            <CardContent className='space-y-4'>
              {/* Saved presets */}
              <div>
                <p className='text-[11px] text-muted-foreground mb-2'>Saved backgrounds</p>
                <div className='flex gap-3 flex-wrap'>
                  {/* Default: leave each frame's own backdrop alone. Explicit
                      and selectable so you can switch back after picking one. */}
                  {(() => {
                    const usingVideo = !bgDescription.trim() && selectedBgId === null;
                    return (
                      <div
                        onClick={() => {
                          setSelectedBgId(null);
                          setBgDescription("");
                          setBackgroundUrl(null);
                          setBackgroundPath(null);
                          setBgName("");
                        }}
                        className={`relative w-40 rounded-xl p-2 transition-all cursor-pointer ${
                          usingVideo
                            ? "glass-strong ring-2 ring-emerald-500/50"
                            : "glass hover:bg-white/5"
                        }`}
                      >
                        <div className='w-full aspect-video rounded-lg bg-white/5 flex items-center justify-center'>
                          <Film className='h-6 w-6 text-muted-foreground' />
                        </div>
                        <p className='text-xs mt-1 truncate'>Video&apos;s own</p>
                        {usingVideo ? (
                          <Badge className='text-[9px] bg-emerald-500/10 text-emerald-400 border-emerald-500/20 border mt-1'>
                            in use
                          </Badge>
                        ) : (
                          <p className='text-[9px] text-muted-foreground mt-1'>
                            keep each frame&apos;s backdrop
                          </p>
                        )}
                      </div>
                    );
                  })()}

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

          {/* Per-shot override. A batch often wants one backdrop for most shots
              and something else for one or two — this keeps the batch default
              meaningful instead of forcing every shot to be set by hand. */}
          {pickedFrames > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className='text-base'>Per shot ({pickedFrames})</CardTitle>
                <p className='text-xs text-muted-foreground mt-1'>
                  Leave a shot on <strong>Batch default</strong> to follow the pick above.
                  Set one explicitly and it keeps that backdrop no matter what the batch changes to.
                </p>
              </CardHeader>
              <CardContent className='space-y-2'>
                {videos.flatMap((vid) =>
                  chosenFrames(vid).map((framePath, idx) => {
                    const style = vid.frameStyles?.[framePath] ?? {};
                    const chosen = style.backgroundId;
                    const chip = (
                      active: boolean,
                      key: string,
                      label: string,
                      onClick: () => void,
                      thumb?: string | null
                    ) => (
                      <button
                        key={key}
                        onClick={onClick}
                        className={`shrink-0 rounded-lg border p-1 transition-colors w-20 ${
                          active
                            ? 'bg-[oklch(0.75_0.15_270_/_25%)] border-white/20 text-white'
                            : 'bg-white/5 border-white/10 text-muted-foreground hover:text-foreground'
                        }`}
                        title={label}
                      >
                        {thumb ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={thumb}
                            alt={label}
                            className='w-full aspect-video rounded object-cover'
                          />
                        ) : (
                          <div className='w-full aspect-video rounded bg-white/5 flex items-center justify-center'>
                            <Film className='h-3 w-3' />
                          </div>
                        )}
                        <span className='block text-[9px] mt-0.5 truncate'>{label}</span>
                      </button>
                    );
                    return (
                      <div
                        key={`${vid.id}:${framePath}`}
                        className='flex gap-3 p-2.5 rounded-xl glass items-start'
                      >
                        <div className='relative shrink-0'>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={fileUrl(framePath)}
                            alt={`shot ${idx + 1}`}
                            className='w-16 aspect-[3/4] rounded-lg object-cover border border-white/10'
                          />
                          <span className='absolute -top-1 -left-1 h-4 w-4 rounded-full bg-[oklch(0.75_0.15_270)] text-white text-[9px] font-semibold flex items-center justify-center'>
                            {idx + 1}
                          </span>
                        </div>
                        <div className='flex-1 min-w-0 flex gap-1.5 overflow-x-auto pb-1'>
                          {chip(
                            chosen === undefined,
                            'default',
                            bgDescription.trim() ? 'Batch default' : 'Batch (none)',
                            () => patchFrameStyle(vid.id, framePath, { backgroundId: undefined }),
                            backgroundUrl
                          )}
                          {chip(
                            chosen === null,
                            'own',
                            "Video's own",
                            () => patchFrameStyle(vid.id, framePath, { backgroundId: null })
                          )}
                          {savedBackgrounds.map((b) =>
                            chip(
                              chosen === b.id,
                              String(b.id),
                              b.name,
                              () => patchFrameStyle(vid.id, framePath, { backgroundId: b.id }),
                              b.imagePath ? fileUrl(b.imagePath) : null
                            )
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
              </CardContent>
            </Card>
          )}
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
