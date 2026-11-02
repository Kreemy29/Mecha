"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  Wand2,
  Search,
  Download,
  CheckSquare,
  Sparkles,
  Play,
  ThumbsUp,
  ThumbsDown,
  Loader2,
  Image as ImageIcon,
  X,
  Pencil,
  RotateCcw,
  Gem,
  Smartphone,
  Wand,
  Layers as LayersIcon,
  Flame,
  Upload,
  HardDrive,
  ExternalLink,
} from "lucide-react";
import { DrivePicker } from "@/components/drive/drive-picker";
import { todayLocal } from "@/lib/day";

interface Character {
  id: number;
  name: string;
  featureProfile: string;
  higgsFieldCharacterRef: string | null;
  baseImagePath: string | null;
}

interface Preset {
  id: number;
  name: string;
  description: string | null;
  searchPromptSeed: string;
  active: boolean;
}

interface PinterestResult {
  imageUrl: string;
  thumbnailUrl: string;
  title: string;
  sourceUrl: string;
  // Where it came from; a fresh Pinterest search only replaces Pinterest's own.
  source?: "pinterest" | "upload" | "drive";
}

interface Job {
  id: number;
  kind: string;
  status: string;
  prompt: string | null;
  outputPath: string | null;
  attempts: number;
  error: string | null;
  promptHistory: Array<Record<string, unknown>>;
  characterId?: number | null;
  providerParams?: {
    drive?: { rootId: string; rootName?: string; model: string; date: string };
    driveUpload?: { ok: boolean; url?: string; folder?: string; error?: string };
  } | null;
}

interface DriveRoot {
  id: string;
  name: string;
  kind: "shared_drive" | "folder";
}

// Still waiting for the worker to copy this output into Drive?
const awaitingDrive = (j: Job) =>
  j.status === "succeeded" && !!j.providerParams?.drive && !j.providerParams?.driveUpload;

interface ProviderModel {
  key: string;
  label: string;
  description: string;
  costPerImage: number | null;
}

interface ProviderInfo {
  id: string;
  name: string;
  models: ProviderModel[];
}

type Step = "setup" | "prompts" | "references" | "recreation" | "generate" | "review";

const STEPS: { key: Step; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { key: "setup", label: "Setup", icon: Wand2 },
  { key: "prompts", label: "Search Prompts", icon: Search },
  { key: "references", label: "References", icon: Download },
  { key: "recreation", label: "Recreation", icon: Sparkles },
  { key: "generate", label: "Generate", icon: Play },
  { key: "review", label: "Review", icon: ThumbsUp },
];

export default function ImagesPage() {
  const [step, setStep] = useState<Step>("setup");
  const [characters, setCharacters] = useState<Character[]>([]);
  const [presets, setPresets] = useState<Preset[]>([]);
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  // Several models at once: the same references are recreated for each one,
  // with a prompt written from that model's own face and profile.
  const [selectedCharacterIds, setSelectedCharacterIds] = useState<number[]>([]);
  const selectedCharacters = characters.filter((c) => selectedCharacterIds.includes(c.id));
  const toggleCharacter = (id: number) =>
    setSelectedCharacterIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  const characterName = (id: number | null | undefined) => characters.find((c) => c.id === id)?.name;
  const [selectedPreset, setSelectedPreset] = useState<Preset | null>(null);
  const [selectedProvider, setSelectedProvider] = useState<string>("higgsfield");
  const [selectedModel, setSelectedModel] = useState<string>("soul_2");

  // Generation controls (Higgsfield-style bar)
  const [genQuality, setGenQuality] = useState<string>("2k");
  const [genAspectRatio, setGenAspectRatio] = useState<string>("3:4");
  const [genEnhance, setGenEnhance] = useState<boolean>(false);
  const [genBatchSize, setGenBatchSize] = useState<number>(1);
  const [genNsfwMode, setGenNsfwMode] = useState<boolean>(false);
  const [rewritingNsfw, setRewritingNsfw] = useState(false);

  // Search prompts
  const [searchPrompts, setSearchPrompts] = useState<string[]>([]);
  const [loadingPrompts, setLoadingPrompts] = useState(false);

  // References
  const [pinterestResults, setPinterestResults] = useState<PinterestResult[]>([]);
  const [selectedRefs, setSelectedRefs] = useState<Set<number>>(new Set());
  const [loadingRefs, setLoadingRefs] = useState(false);
  const [searchingQuery, setSearchingQuery] = useState<string | null>(null);
  const [refSource, setRefSource] = useState<"pinterest" | "upload" | "drive">("pinterest");

  // Google Drive: where references can be imported from and where every
  // generated image is filed (outputs/<model>/<date>/ in the same Drive).
  const [driveRoots, setDriveRoots] = useState<DriveRoot[]>([]);
  const [driveState, setDriveState] = useState<{ configured: boolean; email: string | null; error?: string }>({
    configured: false,
    email: null,
  });
  const [driveRoot, setDriveRoot] = useState<DriveRoot | null>(null);
  const [driveCheck, setDriveCheck] = useState<{ ok: boolean; reason: string | null } | null>(null);
  const [saveToDrive, setSaveToDrive] = useState(true);
  const [browsingDrive, setBrowsingDrive] = useState(false);
  const [uploading, setUploading] = useState(false);
  const refFileInputRef = useRef<HTMLInputElement>(null);

  // Recreation prompts
  const [recreationPrompts, setRecreationPrompts] = useState<
    Array<{
      refIndex: number;
      characterId: number;
      prompt: string;
      imageUrl: string;
      sceneRefUrl: string;
    }>
  >([]);
  const [loadingRecreation, setLoadingRecreation] = useState(false);
  const [recreationProgress, setRecreationProgress] = useState<{ done: number; total: number } | null>(null);
  // Review: show every model, or one.
  const [reviewModel, setReviewModel] = useState<number | "all">("all");

  // Jobs
  const [jobs, setJobs] = useState<Job[]>([]);
  const [pollingJobs, setPollingJobs] = useState(false);
  const [downloading, setDownloading] = useState(false);

  // Reject dialog
  const [rejectDialog, setRejectDialog] = useState<{
    open: boolean;
    jobId: number | null;
    notes: string;
  }>({ open: false, jobId: null, notes: "" });

  const fetchInitialData = useCallback(async () => {
    const [charsRes, presetsRes, providersRes] = await Promise.all([
      fetch("/api/characters"),
      fetch("/api/presets?type=image"),
      fetch("/api/providers"),
    ]);
    setCharacters(await charsRes.json());
    setPresets((await presetsRes.json()).filter((p: Preset) => p.active));
    setProviders(await providersRes.json());
    try {
      const d = await (await fetch("/api/drive")).json();
      setDriveState({ configured: !!d.configured, email: d.email ?? null, error: d.error });
      setDriveRoots(Array.isArray(d.roots) ? d.roots : []);
    } catch {
      setDriveState({ configured: false, email: null, error: "Couldn't reach Google Drive" });
    }
  }, []);

  const pickDriveRoot = async (root: DriveRoot | null) => {
    setDriveRoot(root);
    setDriveCheck(null);
    if (!root) return;
    try {
      const d = await (await fetch(`/api/drive?check=${encodeURIComponent(root.id)}`)).json();
      setDriveCheck(d.error ? { ok: false, reason: d.error } : d);
    } catch {
      setDriveCheck({ ok: false, reason: "Couldn't check this Drive" });
    }
  };

  // The Drive target sent with a model's jobs, if outputs should be filed
  // there: each model gets its own outputs/<model>/<date>/ folder.
  const driveTargetFor = (model: string) =>
    driveRoot && saveToDrive && driveCheck?.ok
      ? { rootId: driveRoot.id, rootName: driveRoot.name, model, date: todayLocal() }
      : undefined;

  useEffect(() => {
    fetchInitialData();
  }, [fetchInitialData]);

  // Poll for job updates when generating
  useEffect(() => {
    if (!pollingJobs || jobs.length === 0) return;
    const interval = setInterval(async () => {
      try {
        const res = await fetch("/api/jobs?limit=50");
        const allJobs: Job[] = await res.json();
        const jobIds = new Set(jobs.map((j) => j.id));
        const updated = allJobs.filter((j) => jobIds.has(j.id));
        setJobs(updated);

        const allDone = updated.every(
          (j) => !["queued", "running", "polling"].includes(j.status)
        );
        if (allDone) {
          setStep("review");
          // Keep polling a little longer while the worker files outputs in Drive.
          if (!updated.some(awaitingDrive)) setPollingJobs(false);
        }
      } catch {
        // silent
      }
    }, 2000);
    return () => clearInterval(interval);
  }, [pollingJobs, jobs]);

  // ── Step 1: Setup ──
  // A preset is only needed to search Pinterest; Drive and upload skip it.
  const canProceedSetup = selectedCharacters.length > 0 && selectedProvider && selectedModel;
  const currentProviderInfo = providers.find((p) => p.id === selectedProvider);
  const currentModelInfo = currentProviderInfo?.models.find((m) => m.key === selectedModel);

  // ── Step 2: Search query (use the preset seed directly, no Grok expansion) ──
  const handleGeneratePrompts = async () => {
    if (!selectedPreset) return;
    // Use the preset's search seed verbatim as the single Pinterest query.
    setSearchPrompts([selectedPreset.searchPromptSeed]);
    // References already imported (Drive, upload) are kept; a new Pinterest
    // fetch replaces only earlier Pinterest results.
    setRecreationPrompts([]);
    toast.success("Loaded preset search query");
  };

  // ── Step 3: Fetch references ──
  const handleFetchReferences = async () => {
    setLoadingRefs(true);
    // Drop the previous Pinterest results but keep imported ones, remapping
    // the selection since it's by index.
    const kept = pinterestResults
      .map((r, i) => ({ r, i }))
      .filter(({ r }) => r.source !== "pinterest");
    setPinterestResults(kept.map(({ r }) => r));
    setSelectedRefs(new Set(kept.flatMap(({ i }, n) => (selectedRefs.has(i) ? [n] : []))));

    let total = 0;
    let lastError = "";

    for (const query of searchPrompts) {
      setSearchingQuery(query);
      try {
        const res = await fetch("/api/references/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query, pages: 2 }),
        });
        const data = await res.json();
        if (data.error) {
          lastError = data.error;
          toast.error(`"${query}": ${data.error}`);
        } else if (Array.isArray(data.results)) {
          total += data.results.length;
          setPinterestResults((prev) => [
            ...prev,
            ...data.results.map((r: PinterestResult) => ({ ...r, source: "pinterest" as const })),
          ]);
        }
      } catch {
        lastError = "network error";
        toast.error(`Failed to search: ${query}`);
      }
    }

    setSearchingQuery(null);
    setLoadingRefs(false);

    if (total > 0) {
      toast.success(`Found ${total} reference images`);
    } else if (lastError) {
      toast.error(`No results — ${lastError}`);
    } else {
      toast.warning("No reference images found for these queries");
    }
  };

  // ── Step 3 (alt): upload local images as references ──
  const handleUploadRefs = async (files: FileList) => {
    setUploading(true);
    try {
      const form = new FormData();
      Array.from(files).forEach((f) => form.append("files", f));
      const res = await fetch("/api/references/upload", {
        method: "POST",
        body: form,
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      const added: PinterestResult[] = data.results || [];
      setPinterestResults((prev) => [...prev, ...added]);
      toast.success(`Uploaded ${added.length} image${added.length === 1 ? "" : "s"}`);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  // Images imported from Drive were picked in the browser already, so they
  // arrive selected.
  const addImportedRefs = (refs: PinterestResult[]) => {
    const start = pinterestResults.length;
    setPinterestResults((prev) => [...prev, ...refs]);
    setSelectedRefs((prev) => {
      const next = new Set(prev);
      refs.forEach((_, i) => next.add(start + i));
      return next;
    });
  };

  const toggleRef = (index: number) => {
    setSelectedRefs((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  // ── Step 4: Write recreation prompts (Visual Subject Swap via Grok vision) ──
  // One prompt per (reference × model): each is written from that model's own
  // face image and profile, so the same scene is recreated for every model.
  const handleWriteRecreation = async () => {
    const withoutFace = selectedCharacters.filter((c) => !c.baseImagePath);
    const models = selectedCharacters.filter((c) => c.baseImagePath);
    if (withoutFace.length) {
      toast.error(
        `Skipping ${withoutFace.map((c) => c.name).join(", ")}: no face reference image. Sync from Higgsfield or add a base image.`
      );
    }
    if (models.length === 0) return;

    const pairs = models.flatMap((c) =>
      Array.from(selectedRefs)
        .filter((idx) => pinterestResults[idx])
        .map((idx) => ({ c, idx }))
    );
    setLoadingRecreation(true);
    setRecreationProgress({ done: 0, total: pairs.length });
    const results: Array<(typeof recreationPrompts)[number] | null> = new Array(pairs.length).fill(null);

    const writeOne = async ({ c, idx }: (typeof pairs)[number], slot: number) => {
      const ref = pinterestResults[idx];
      const faceRefUrl = c.baseImagePath!.startsWith("http")
        ? c.baseImagePath!
        : `${window.location.origin}/api/files/${c.baseImagePath}`;
      try {
        // Visual Subject Swap: scene = reference image, face = the model's image
        const res = await fetch("/api/grok/swap-prompt", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sceneRefUrl: ref.imageUrl || ref.thumbnailUrl,
            faceRefUrl,
            settingDescription: c.featureProfile,
            characterName: c.name,
          }),
        });
        const data = await res.json();
        if (data.prompt) {
          results[slot] = {
            refIndex: idx,
            characterId: c.id,
            prompt: data.prompt,
            imageUrl: ref.thumbnailUrl,
            sceneRefUrl: ref.imageUrl || ref.thumbnailUrl,
          };
        } else if (data.error) {
          toast.error(`${c.name}, ref #${idx + 1}: ${data.error}`);
        }
      } catch {
        toast.error(`Failed to write the prompt for ${c.name}, ref #${idx + 1}`);
      } finally {
        setRecreationProgress((p) => (p ? { ...p, done: p.done + 1 } : p));
      }
    };

    // A few Grok calls at a time: all models at once, without a burst of
    // dozens of requests.
    let next = 0;
    await Promise.all(
      Array.from({ length: Math.min(4, pairs.length) }, async () => {
        while (next < pairs.length) {
          const slot = next++;
          await writeOne(pairs[slot], slot);
        }
      })
    );

    const prompts = results.filter((r): r is NonNullable<typeof r> => !!r);
    setRecreationPrompts(prompts);
    setLoadingRecreation(false);
    setRecreationProgress(null);
    toast.success(
      `Wrote ${prompts.length} prompt${prompts.length === 1 ? "" : "s"} for ${models.length} model${models.length === 1 ? "" : "s"}`
    );
  };

  // ── Step 5: Generate images ──
  const handleGenerate = async () => {
    const newJobs: Job[] = [];
    let promptsToGenerate = recreationPrompts;

    if (genNsfwMode) {
      setRewritingNsfw(true);
      try {
        promptsToGenerate = await Promise.all(
          recreationPrompts.map(async (rp) => {
            const res = await fetch("/api/grok/nsfw-prompt", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                prompt: rp.prompt,
                characterProfile: characters.find((c) => c.id === rp.characterId)?.featureProfile || "",
              }),
            });
            const data = await res.json();
            if (!res.ok || data.error) {
              throw new Error(data.error || "Failed to prepare NSFW prompt");
            }
            return { ...rp, prompt: data.prompt || rp.prompt };
          })
        );
        setRecreationPrompts(promptsToGenerate);
        toast.success("NSFW prompt mode applied");
      } catch (err: unknown) {
        const msg =
          err instanceof Error ? err.message : "Failed to prepare NSFW prompts";
        toast.error(msg);
        return;
      } finally {
        setRewritingNsfw(false);
      }
    }

    for (const rp of promptsToGenerate) {
      const drive = driveTargetFor(characterName(rp.characterId) || "Unknown model");
      const providerParams = {
        quality: genQuality,
        aspectRatio: genAspectRatio,
        enhancePrompt: genEnhance,
        sceneRefUrl: rp.sceneRefUrl,
        ...(drive ? { drive } : {}),
      };
      // batch size = number of images per prompt (one job each)
      for (let i = 0; i < genBatchSize; i++) {
        try {
          const res = await fetch("/api/jobs", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              kind: "image",
              prompt: rp.prompt,
              provider: selectedProvider,
              providerModel: selectedModel,
              providerParams,
              characterId: rp.characterId,
            }),
          });
          const job = await res.json();
          newJobs.push(job);
        } catch {
          toast.error("Failed to create job");
        }
      }
    }

    setJobs(newJobs);
    setReviewModel("all");
    setPollingJobs(true);
    setStep("generate");
    toast.success(
      `Enqueued ${newJobs.length} jobs via ${currentProviderInfo?.name || selectedProvider} / ${currentModelInfo?.label || selectedModel}`
    );
  };

  // ── Step 6: Review ──
  const handleApprove = async (jobId: number) => {
    try {
      await fetch(`/api/jobs/${jobId}/approve`, { method: "POST" });
      toast.success("Image approved");
      setJobs((prev) =>
        prev.map((j) =>
          j.id === jobId
            ? { ...j, promptHistory: [...j.promptHistory, { action: "approved" }] }
            : j
        )
      );
    } catch {
      toast.error("Failed to approve");
    }
  };

  const handleReject = async () => {
    if (!rejectDialog.jobId || !rejectDialog.notes.trim()) return;
    try {
      const res = await fetch(`/api/jobs/${rejectDialog.jobId}/reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rejectionNotes: rejectDialog.notes }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);

      toast.success("Rewritten prompt generated, new job queued");
      setJobs((prev) => [
        ...prev.map((j) =>
          j.id === rejectDialog.jobId ? { ...j, status: "rejected" } : j
        ),
        data.newJob,
      ]);
      setPollingJobs(true);
      setRejectDialog({ open: false, jobId: null, notes: "" });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to reject";
      toast.error(msg);
    }
  };

  const isApproved = (job: Job) =>
    job.promptHistory?.some((h) => (h as Record<string, unknown>).action === "approved");

  const handleDownloadAll = async (approvedOnly = false) => {
    const source = approvedOnly ? jobs.filter((j) => isApproved(j)) : jobs;
    const jobIds = source
      .filter((j) => j.status === "succeeded" && j.outputPath)
      .map((j) => j.id);

    if (jobIds.length === 0) {
      toast.error("No completed media to download");
      return;
    }

    setDownloading(true);
    try {
      const res = await fetch("/api/jobs/download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobIds }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Download failed (${res.status})`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `mecha-ai-${Date.now()}.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success(`Downloaded ${jobIds.length} images`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Download failed";
      toast.error(msg);
    } finally {
      setDownloading(false);
    }
  };

  const currentStepIndex = STEPS.findIndex((s) => s.key === step);

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight">
          Image Generation
        </h2>
        <p className="text-sm text-muted-foreground mt-1">
          Full pipeline: preset &rarr; search &rarr; reference &rarr; recreate &rarr; generate &rarr; review
        </p>
      </div>

      {/* Step indicator */}
      <div className="flex items-center gap-1">
        {STEPS.map((s, i) => {
          const Icon = s.icon;
          const isActive = s.key === step;
          const isPast = i < currentStepIndex;
          return (
            <button
              key={s.key}
              onClick={() => {
                if (isPast || isActive) setStep(s.key);
              }}
              className={`flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-medium transition-all ${
                isActive
                  ? "glass-strong text-foreground border-white/15"
                  : isPast
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
              <div className="flex items-center justify-between gap-2">
                <CardTitle className="text-sm">
                  Select models
                  {selectedCharacters.length > 0 && (
                    <span className="ml-2 font-normal text-xs text-muted-foreground">
                      {selectedCharacters.length} selected
                    </span>
                  )}
                </CardTitle>
                {characters.length > 1 && (
                  <button
                    type="button"
                    onClick={() =>
                      setSelectedCharacterIds(
                        selectedCharacters.length === characters.length ? [] : characters.map((c) => c.id)
                      )
                    }
                    className="text-xs text-brand hover:underline"
                  >
                    {selectedCharacters.length === characters.length ? "Clear" : "Select all"}
                  </button>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                Pick one or several: each reference is recreated for every model you pick.
              </p>
            </CardHeader>
            <CardContent className="space-y-2">
              {characters.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  No characters yet.{" "}
                  <a href="/characters" className="text-brand hover:underline">
                    Create one first
                  </a>
                </p>
              ) : (
                characters.map((c) => {
                  const thumb = c.baseImagePath
                    ? c.baseImagePath.startsWith("http")
                      ? c.baseImagePath
                      : `/api/files/${c.baseImagePath}`
                    : null;
                  const on = selectedCharacterIds.includes(c.id);
                  return (
                    <button
                      key={c.id}
                      onClick={() => toggleCharacter(c.id)}
                      className={`w-full text-left p-3 rounded-xl transition-all flex gap-3 items-center border ${
                        on ? "border-brand bg-brand/10" : "glass border-transparent hover:bg-white/5"
                      }`}
                    >
                      <Checkbox
                        checked={on}
                        className="shrink-0 border-white/40 data-[state=checked]:bg-brand data-[state=checked]:border-brand"
                      />
                      <div className="h-12 w-12 rounded-lg overflow-hidden bg-white/5 shrink-0">
                        {thumb ? (
                          <img
                            src={thumb}
                            alt={c.name}
                            className="h-full w-full object-cover"
                            loading="lazy"
                          />
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
              <CardTitle className="text-sm">Select Preset</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {presets.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  No active presets.{" "}
                  <a href="/presets" className="text-brand hover:underline">
                    Create or seed presets
                  </a>
                </p>
              ) : (
                presets.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => setSelectedPreset(p)}
                    className={`w-full text-left p-3 rounded-xl transition-all ${
                      selectedPreset?.id === p.id
                        ? "glass-strong border-brand/30"
                        : "glass hover:bg-white/5"
                    }`}
                  >
                    <div className="font-medium text-sm">{p.name}</div>
                    {p.description && (
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {p.description}
                      </p>
                    )}
                    <p className="text-xs text-muted-foreground/60 font-mono mt-1">
                      {p.searchPromptSeed}
                    </p>
                  </button>
                ))
              )}
            </CardContent>
          </Card>

          {/* Google Drive: references in, outputs filed by model and day */}
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle className="text-sm flex items-center gap-2">
                <HardDrive className="h-4 w-4" /> Google Drive
                <span className="text-xs font-normal text-muted-foreground">optional</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {!driveState.configured ? (
                <p className="text-xs text-muted-foreground">
                  {driveState.error || "Google Drive isn't set up on the server."}
                </p>
              ) : driveRoots.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  No Drive is shared with the app yet. Share a Shared Drive (or a folder inside one) with{" "}
                  <span className="font-mono text-foreground">{driveState.email}</span> as Content manager, then reload.
                </p>
              ) : (
                <>
                  {!driveRoot && (
                    <p className="text-xs text-muted-foreground">
                      Click a Drive to browse it, import reference photos from it, and save every generated
                      image back into it, sorted by model and day.
                    </p>
                  )}
                  <div className="flex flex-wrap gap-2">
                    {driveRoots.map((r) => {
                      const on = driveRoot?.id === r.id;
                      return (
                        <button
                          key={r.id}
                          onClick={() => {
                            pickDriveRoot(on ? null : r);
                            setBrowsingDrive(false);
                          }}
                          className={`flex items-center gap-2 p-3 rounded-xl text-sm transition-all border ${
                            on ? "border-brand bg-brand/10 text-foreground" : "glass border-transparent hover:bg-white/5"
                          }`}
                        >
                          {on ? <CheckSquare className="h-4 w-4 text-brand" /> : <HardDrive className="h-4 w-4 text-brand" />}
                          {r.name}
                        </button>
                      );
                    })}
                  </div>
                  {driveRoot && (
                    <div className="space-y-2 text-xs">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setBrowsingDrive((b) => !b)}
                          className="h-8 rounded-lg border-white/10 gap-1.5 text-xs"
                        >
                          <HardDrive className="h-3.5 w-3.5" />
                          {browsingDrive ? "Hide folders" : "Browse folders / new folder"}
                        </Button>
                        {pinterestResults.length > 0 && (
                          <span className="text-muted-foreground">
                            {pinterestResults.length} reference{pinterestResults.length === 1 ? "" : "s"} imported so far
                            (you&apos;ll see them in the References step)
                          </span>
                        )}
                      </div>
                      {browsingDrive && (
                        <DrivePicker rootId={driveRoot.id} rootName={driveRoot.name} onImported={addImportedRefs} />
                      )}
                      {driveCheck === null ? (
                        <p className="flex items-center gap-1.5 text-muted-foreground">
                          <Loader2 className="h-3 w-3 animate-spin" /> Checking it can store outputs…
                        </p>
                      ) : driveCheck.ok ? (
                        <label className="flex items-center gap-2 cursor-pointer">
                          <Checkbox checked={saveToDrive} onCheckedChange={(v) => setSaveToDrive(v === true)} />
                          <span>
                            Save every generated image to{" "}
                            <span className="font-mono text-foreground">
                              {driveRoot.name}/outputs/
                              {selectedCharacters.length === 1 ? selectedCharacters[0].name : "<model>"}/{todayLocal()}/
                            </span>
                            {selectedCharacters.length > 1 && (
                              <span className="text-muted-foreground">
                                {" "}
                                (one folder per model: {selectedCharacters.map((c) => c.name).join(", ")})
                              </span>
                            )}
                          </span>
                        </label>
                      ) : (
                        <p className="text-orange-400">Outputs can&apos;t be saved here: {driveCheck.reason}</p>
                      )}
                    </div>
                  )}
                </>
              )}
            </CardContent>
          </Card>

          {/* Provider + Model Selection */}
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle className="text-sm">Generation Provider & Model</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-2">
                {providers.map((prov) =>
                  prov.models.map((model) => {
                    const isSelected =
                      selectedProvider === prov.id && selectedModel === model.key;
                    return (
                      <button
                        key={`${prov.id}:${model.key}`}
                        onClick={() => {
                          setSelectedProvider(prov.id);
                          setSelectedModel(model.key);
                        }}
                        className={`text-left p-3 rounded-xl transition-all min-w-[200px] flex-1 max-w-[300px] ${
                          isSelected
                            ? "glass-strong border-brand/30"
                            : "glass hover:bg-white/5"
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-medium text-sm">{model.label}</span>
                          {model.costPerImage !== null && (
                            <Badge
                              variant="outline"
                              className="text-[10px] border-white/10 bg-white/5 ml-2"
                            >
                              ${model.costPerImage}/img
                            </Badge>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {model.description}
                        </p>
                        <p className="text-[10px] text-muted-foreground/50 font-mono mt-1">
                          {prov.name}
                        </p>
                      </button>
                    );
                  })
                )}
              </div>
            </CardContent>
          </Card>

          <div className="lg:col-span-2 flex justify-end">
            <Button
              disabled={!canProceedSetup}
              onClick={() => {
                if (selectedPreset) {
                  handleGeneratePrompts();
                  setRefSource("pinterest");
                  setStep("prompts");
                } else {
                  // No preset = no Pinterest search; go pick references.
                  setRefSource(driveRoot ? "drive" : "upload");
                  setStep("references");
                }
              }}
              className="rounded-xl bg-brand hover:bg-brand/90 text-brand-foreground gap-2"
            >
              {selectedPreset ? "Next: Search Query" : "Next: References"}
              <Wand2 className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {/* ── STEP: Search Prompts ── */}
      {step === "prompts" && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">Search Query</CardTitle>
              <Button
                onClick={handleGeneratePrompts}
                disabled={loadingPrompts}
                size="sm"
                className="rounded-xl bg-brand hover:bg-brand/90 text-brand-foreground gap-2"
              >
                <Search className="h-4 w-4" />
                {searchPrompts.length > 0 ? "Reload from preset" : "Load preset query"}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Using preset: <strong>{selectedPreset?.name}</strong> — its seed is used
              directly as the Pinterest search query. Edit it below if you like.
            </p>
          </CardHeader>
          <CardContent className="space-y-3">
            {searchPrompts.length === 0 && !loadingPrompts && (
              <p className="text-sm text-muted-foreground text-center py-8">
                Click &ldquo;Load preset query&rdquo; to use the preset&apos;s search seed.
              </p>
            )}
            {loadingPrompts && (
              <div className="space-y-2">
                {[1, 2, 3, 4, 5].map((i) => (
                  <Skeleton key={i} className="h-10 w-full bg-white/5 rounded-lg" />
                ))}
              </div>
            )}
            {searchPrompts.map((prompt, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground w-6">{i + 1}.</span>
                <Textarea
                  value={prompt}
                  onChange={(e) => {
                    const updated = [...searchPrompts];
                    updated[i] = e.target.value;
                    setSearchPrompts(updated);
                  }}
                  rows={1}
                  className="glass border-white/10 resize-none text-sm flex-1"
                />
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 rounded-lg shrink-0 hover:bg-red-500/10 hover:text-red-400"
                  onClick={() =>
                    setSearchPrompts((prev) => prev.filter((_, j) => j !== i))
                  }
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
            {searchPrompts.length > 0 && (
              <div className="flex justify-end pt-2">
                <Button
                  onClick={() => setStep("references")}
                  className="rounded-xl bg-brand hover:bg-brand/90 text-brand-foreground gap-2"
                >
                  Next: Fetch References
                  <Search className="h-4 w-4" />
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── STEP: References ── */}
      {step === "references" && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-base">Reference Images</CardTitle>
                {searchingQuery && (
                  <p className="text-xs text-muted-foreground mt-1 flex items-center gap-2">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Searching: {searchingQuery}
                  </p>
                )}
              </div>
              <div className="flex gap-2 items-center flex-wrap">
                {/* Reference source toggle */}
                <div className="glass rounded-xl p-1 flex text-xs">
                  <button
                    onClick={() => setRefSource("pinterest")}
                    className={`px-3 py-1.5 rounded-lg transition-colors ${
                      refSource === "pinterest"
                        ? "bg-white/10 text-foreground"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    Pinterest
                  </button>
                  <button
                    onClick={() => setRefSource("upload")}
                    className={`px-3 py-1.5 rounded-lg transition-colors ${
                      refSource === "upload"
                        ? "bg-white/10 text-foreground"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    Upload
                  </button>
                  {driveRoot && (
                    <button
                      onClick={() => setRefSource("drive")}
                      className={`px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1 ${
                        refSource === "drive"
                          ? "bg-white/10 text-foreground"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      <HardDrive className="h-3 w-3" /> Drive
                    </button>
                  )}
                </div>

                {refSource === "drive" ? null : refSource === "pinterest" ? (
                  <Button
                    onClick={handleFetchReferences}
                    disabled={loadingRefs}
                    size="sm"
                    variant={pinterestResults.length > 0 ? "outline" : "default"}
                    className={
                      pinterestResults.length > 0
                        ? "rounded-xl border-white/10 gap-2"
                        : "rounded-xl bg-brand hover:bg-brand/90 text-brand-foreground gap-2"
                    }
                  >
                    {loadingRefs ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : pinterestResults.length > 0 ? (
                      <RotateCcw className="h-4 w-4" />
                    ) : (
                      <Download className="h-4 w-4" />
                    )}
                    {pinterestResults.length > 0 ? "Re-fetch" : "Fetch References"}
                  </Button>
                ) : (
                  <>
                    <input
                      ref={refFileInputRef}
                      type="file"
                      accept="image/*"
                      multiple
                      className="hidden"
                      onChange={(e) => {
                        if (e.target.files?.length) handleUploadRefs(e.target.files);
                        e.target.value = "";
                      }}
                    />
                    <Button
                      onClick={() => refFileInputRef.current?.click()}
                      disabled={uploading}
                      size="sm"
                      className="rounded-xl bg-brand hover:bg-brand/90 text-brand-foreground gap-2"
                    >
                      {uploading ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Upload className="h-4 w-4" />
                      )}
                      Upload Images
                    </Button>
                  </>
                )}

                {selectedRefs.size > 0 && (
                  <Button
                    onClick={() => setStep("recreation")}
                    size="sm"
                    className="rounded-xl bg-brand hover:bg-brand/90 text-brand-foreground gap-2"
                  >
                    Use {selectedRefs.size} Selected
                    <CheckSquare className="h-4 w-4" />
                  </Button>
                )}
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {refSource === "drive" && driveRoot && (
              <DrivePicker rootId={driveRoot.id} rootName={driveRoot.name} onImported={addImportedRefs} />
            )}
            {pinterestResults.length === 0 && !loadingRefs && !uploading ? (
              refSource === "drive" ? null : (
                <p className="text-sm text-muted-foreground text-center py-8">
                  {refSource === "upload"
                    ? "Upload images from your computer to use as references, then select the ones to recreate."
                    : "Click fetch to search Pinterest with your generated prompts."}
                </p>
              )
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
                {pinterestResults.map((ref, i) => (
                  <button
                    key={i}
                    onClick={() => toggleRef(i)}
                    className={`relative rounded-xl overflow-hidden border-2 transition-all aspect-square group ${
                      selectedRefs.has(i)
                        ? "border-brand shadow-lg shadow-brand/20"
                        : "border-transparent hover:border-white/20"
                    }`}
                  >
                    <img
                      src={ref.thumbnailUrl}
                      alt={ref.title || "Reference"}
                      className="w-full h-full object-cover"
                      loading="lazy"
                    />
                    <div
                      className={`absolute inset-0 transition-all ${
                        selectedRefs.has(i)
                          ? "bg-brand/20"
                          : "bg-black/0 group-hover:bg-black/20"
                      }`}
                    />
                    <div className="absolute top-2 right-2">
                      <Checkbox
                        checked={selectedRefs.has(i)}
                        className="border-white/50 data-[state=checked]:bg-brand data-[state=checked]:border-brand"
                      />
                    </div>
                    {ref.title && (
                      <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/60 to-transparent p-2">
                        <p className="text-[10px] text-white/80 line-clamp-1">
                          {ref.title}
                        </p>
                      </div>
                    )}
                  </button>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── STEP: Recreation Prompts ── */}
      {step === "recreation" && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">Recreation Prompts</CardTitle>
              <div className="flex gap-2">
                {recreationPrompts.length === 0 && (
                  <Button
                    onClick={handleWriteRecreation}
                    disabled={loadingRecreation}
                    size="sm"
                    className="rounded-xl bg-brand hover:bg-brand/90 text-brand-foreground gap-2"
                  >
                    {loadingRecreation ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Sparkles className="h-4 w-4" />
                    )}
                    Write Prompts
                  </Button>
                )}
                {recreationPrompts.length > 0 && (
                  <Button
                    onClick={handleGenerate}
                    disabled={rewritingNsfw}
                    size="sm"
                    className="rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white gap-2"
                  >
                    {rewritingNsfw ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Play className="h-4 w-4" />
                    )}
                    {rewritingNsfw
                      ? "Preparing NSFW"
                      : `Generate ${recreationPrompts.length * genBatchSize} Images`}
                  </Button>
                )}
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Generation controls bar */}
            {recreationPrompts.length > 0 && (
              <GenerationControlsBar
                quality={genQuality}
                setQuality={setGenQuality}
                aspectRatio={genAspectRatio}
                setAspectRatio={setGenAspectRatio}
                enhance={genEnhance}
                setEnhance={setGenEnhance}
                batchSize={genBatchSize}
                setBatchSize={setGenBatchSize}
                nsfwMode={genNsfwMode}
                setNsfwMode={setGenNsfwMode}
                isSoul={selectedModel === "soul_2" || selectedModel === "soul_cinematic"}
              />
            )}
            {recreationPrompts.length === 0 && !loadingRecreation && (
              <p className="text-sm text-muted-foreground text-center py-8">
                Click write prompts to write a recreation prompt for each of your {selectedRefs.size} selected
                reference{selectedRefs.size === 1 ? "" : "s"} ×{" "}
                {selectedCharacters.map((c) => c.name).join(", ") || "your models"}
                {selectedCharacters.length > 1 && ` (${selectedRefs.size * selectedCharacters.length} prompts)`}.
              </p>
            )}
            {loadingRecreation && (
              <div className="flex items-center justify-center py-8 gap-2 text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin" />
                <span className="text-sm">
                  Writing recreation prompts with Grok
                  {recreationProgress && ` (${recreationProgress.done}/${recreationProgress.total})`}…
                </span>
              </div>
            )}
            {recreationPrompts.map((rp, i) => (
              <div key={i} className="flex gap-4 p-4 rounded-xl glass">
                <img
                  src={rp.imageUrl}
                  alt="Reference"
                  className="w-20 h-20 rounded-lg object-cover shrink-0"
                />
                <div className="flex-1 space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="text-xs border-white/10 bg-white/5">
                        Prompt #{i + 1}
                      </Badge>
                      <Badge className="text-xs bg-brand/10 text-brand border-brand/20 border">
                        {characterName(rp.characterId) || "Unknown model"}
                      </Badge>
                      <span className="text-[11px] text-muted-foreground">ref #{rp.refIndex + 1}</span>
                    </div>
                  </div>
                  <Textarea
                    value={rp.prompt}
                    onChange={(e) => {
                      const updated = [...recreationPrompts];
                      updated[i] = { ...updated[i], prompt: e.target.value };
                      setRecreationPrompts(updated);
                    }}
                    rows={4}
                    className="glass border-white/10 resize-none text-xs"
                  />
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* ── STEP: Generate (live status) ── */}
      {step === "generate" && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              {pollingJobs && <Loader2 className="h-4 w-4 animate-spin" />}
              Generating Images
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {jobs.map((job) => {
                const sc: Record<string, { color: string }> = {
                  queued: { color: "bg-amber-500/10 text-amber-400 border-amber-500/20" },
                  running: { color: "bg-blue-500/10 text-blue-400 border-blue-500/20" },
                  polling: { color: "bg-cyan-500/10 text-cyan-400 border-cyan-500/20" },
                  succeeded: { color: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" },
                  failed: { color: "bg-red-500/10 text-red-400 border-red-500/20" },
                  filtered: { color: "bg-orange-500/10 text-orange-400 border-orange-500/20" },
                  rejected: { color: "bg-brand/10 text-brand border-brand/20" },
                };
                return (
                  <div key={job.id} className="p-4 rounded-xl glass space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-muted-foreground truncate">
                        <span className="font-mono">#{job.id}</span>
                        {characterName(job.characterId) && (
                          <span className="ml-1.5 font-medium text-foreground">{characterName(job.characterId)}</span>
                        )}
                      </span>
                      <Badge className={`text-xs border ${sc[job.status]?.color || ""}`}>
                        {["running", "polling", "queued"].includes(job.status) && (
                          <Loader2 className="h-3 w-3 animate-spin mr-1" />
                        )}
                        {job.status}
                      </Badge>
                    </div>
                    {job.outputPath ? (
                      <img
                        src={`/api/files/${job.outputPath}`}
                        alt="Generated"
                        className="w-full aspect-square rounded-lg object-cover bg-white/5"
                      />
                    ) : (
                      <Skeleton className="w-full aspect-square rounded-lg bg-white/5" />
                    )}
                    <p className="text-xs text-muted-foreground line-clamp-2">
                      {job.prompt}
                    </p>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── STEP: Review ── */}
      {step === "review" && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-base">Review Results</CardTitle>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {jobs.filter((j) => j.status === "succeeded").length} ready ·{" "}
                  {jobs.filter((j) => isApproved(j)).length} approved
                </p>
              </div>
              <div className="flex gap-2">
                <Button
                  // Wrapped: onClick hands the handler a MouseEvent, which
                  // would arrive as `approvedOnly` and read as truthy.
                  onClick={() => handleDownloadAll()}
                  disabled={
                    downloading ||
                    jobs.filter((j) => j.status === "succeeded").length === 0
                  }
                  size="sm"
                  variant="outline"
                  className="rounded-xl border-white/10 gap-2"
                >
                  {downloading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Download className="h-4 w-4" />
                  )}
                  Download All
                </Button>
                {jobs.some((j) => isApproved(j)) && (
                  <Button
                    onClick={() => handleDownloadAll(true)}
                    disabled={downloading}
                    size="sm"
                    variant="outline"
                    className="rounded-xl border-white/10 gap-2"
                  >
                    <Download className="h-4 w-4" />
                    Approved Only
                  </Button>
                )}
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {(() => {
              // One chip per model in this batch, to review them one by one.
              const ids = [...new Set(jobs.map((j) => j.characterId).filter((id): id is number => !!id))];
              if (ids.length < 2) return null;
              const chip = (key: number | "all", label: string, count: number) => (
                <button
                  key={String(key)}
                  type="button"
                  onClick={() => setReviewModel(key)}
                  className={`rounded-lg px-3 py-1.5 text-xs transition-colors ${
                    reviewModel === key ? "bg-white/10 text-foreground" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {label} <span className="text-muted-foreground">{count}</span>
                </button>
              );
              return (
                <div className="glass rounded-xl p-1 flex flex-wrap gap-0.5">
                  {chip("all", "All models", jobs.length)}
                  {ids.map((id) =>
                    chip(id, characterName(id) || `Model ${id}`, jobs.filter((j) => j.characterId === id).length)
                  )}
                </div>
              );
            })()}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {jobs
                .filter((j) => reviewModel === "all" || j.characterId === reviewModel)
                .map((job) => (
                <div key={job.id} className="p-4 rounded-xl glass space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground truncate">
                      <span className="font-mono">#{job.id}</span>
                      {characterName(job.characterId) && (
                        <span className="ml-1.5 font-medium text-foreground">{characterName(job.characterId)}</span>
                      )}
                    </span>
                    {isApproved(job) ? (
                      <Badge className="text-xs bg-emerald-500/10 text-emerald-400 border-emerald-500/20 border">
                        Approved
                      </Badge>
                    ) : job.status === "rejected" ? (
                      <Badge className="text-xs bg-brand/10 text-brand border-brand/20 border gap-1">
                        <RotateCcw className="h-3 w-3" />
                        Redoing
                      </Badge>
                    ) : job.status === "filtered" ? (
                      <Badge className="text-xs bg-orange-500/10 text-orange-400 border-orange-500/20 border">
                        Filtered
                      </Badge>
                    ) : job.status === "failed" ? (
                      <Badge className="text-xs bg-red-500/10 text-red-400 border-red-500/20 border">
                        Failed
                      </Badge>
                    ) : (
                      <Badge className="text-xs bg-white/5 border-white/10 border">
                        {job.status}
                      </Badge>
                    )}
                  </div>

                  {job.outputPath ? (
                    <img
                      src={`/api/files/${job.outputPath}`}
                      alt="Generated"
                      className="w-full aspect-square rounded-lg object-cover bg-white/5"
                    />
                  ) : (
                    <div className="w-full aspect-square rounded-lg bg-white/5 flex items-center justify-center">
                      <ImageIcon className="h-8 w-8 text-muted-foreground/30" />
                    </div>
                  )}

                  <p className="text-xs text-muted-foreground line-clamp-2">
                    {job.prompt}
                  </p>

                  {job.error && (
                    <p className="text-xs text-red-400/80">{job.error}</p>
                  )}

                  {/* Where the worker filed it in Drive */}
                  {job.status === "succeeded" && job.providerParams?.drive && (
                    <div className="flex items-center gap-1.5 text-[11px]">
                      <HardDrive className="h-3 w-3 shrink-0 text-muted-foreground" />
                      {!job.providerParams.driveUpload ? (
                        <span className="flex items-center gap-1 text-muted-foreground">
                          <Loader2 className="h-3 w-3 animate-spin" /> Saving to Drive…
                        </span>
                      ) : job.providerParams.driveUpload.ok ? (
                        <>
                          <span className="truncate text-muted-foreground">
                            Saved to {job.providerParams.drive.rootName}/{job.providerParams.driveUpload.folder}
                          </span>
                          {job.providerParams.driveUpload.url && (
                            <a
                              href={job.providerParams.driveUpload.url}
                              target="_blank"
                              rel="noreferrer"
                              className="ml-auto shrink-0 text-brand hover:underline flex items-center gap-0.5"
                            >
                              Open <ExternalLink className="h-3 w-3" />
                            </a>
                          )}
                        </>
                      ) : (
                        <span className="text-orange-400 line-clamp-2">
                          Not saved to Drive: {job.providerParams.driveUpload.error}
                        </span>
                      )}
                    </div>
                  )}

                  {/* Rejection note + redo workflow */}
                  {job.status === "rejected" &&
                    (() => {
                      const note = [...(job.promptHistory || [])]
                        .reverse()
                        .find(
                          (h) => (h as Record<string, unknown>).rejectionNote
                        ) as { rejectionNote?: string } | undefined;
                      return note?.rejectionNote ? (
                        <div className="rounded-lg bg-brand/5 border border-brand/15 p-2">
                          <p className="text-[10px] uppercase tracking-wider text-brand/80 mb-1 flex items-center gap-1">
                            <RotateCcw className="h-3 w-3" />
                            Rejected — regenerating
                          </p>
                          <p className="text-xs text-muted-foreground italic">
                            &ldquo;{note.rejectionNote}&rdquo;
                          </p>
                        </div>
                      ) : null;
                    })()}

                  {job.status === "filtered" && (
                    <Button
                      onClick={() =>
                        setRejectDialog({ open: true, jobId: job.id, notes: "" })
                      }
                      size="sm"
                      variant="outline"
                      className="w-full rounded-xl border-white/10 gap-1.5 h-9"
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                      Retry with new prompt
                    </Button>
                  )}

                  {job.status === "succeeded" && !isApproved(job) && (
                    <div className="flex gap-2">
                      <Button
                        onClick={() => handleApprove(job.id)}
                        size="sm"
                        className="flex-1 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white gap-1.5 h-9"
                      >
                        <ThumbsUp className="h-3.5 w-3.5" />
                        Approve
                      </Button>
                      <Button
                        onClick={() =>
                          setRejectDialog({
                            open: true,
                            jobId: job.id,
                            notes: "",
                          })
                        }
                        size="sm"
                        variant="outline"
                        className="flex-1 rounded-xl border-white/10 gap-1.5 h-9 hover:bg-red-500/10 hover:text-red-400 hover:border-red-500/20"
                      >
                        <ThumbsDown className="h-3.5 w-3.5" />
                        Reject
                      </Button>
                    </div>
                  )}

                  {job.attempts > 0 && (
                    <p className="text-xs text-muted-foreground/60">
                      Attempt #{job.attempts + 1}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Reject Dialog ── */}
      <Dialog
        open={rejectDialog.open}
        onOpenChange={(open) =>
          setRejectDialog((prev) => ({ ...prev, open }))
        }
      >
        <DialogContent className="glass-strong border-white/10 sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Reject with Notes</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <p className="text-xs text-muted-foreground">
              Describe what should change. Grok will rewrite the prompt based
              on your feedback and queue a new generation.
            </p>
            <Textarea
              value={rejectDialog.notes}
              onChange={(e) =>
                setRejectDialog((prev) => ({ ...prev, notes: e.target.value }))
              }
              placeholder="e.g. 'Make the lighting warmer, less blue tint. The pose should be more relaxed and casual.'"
              rows={4}
              className="glass border-white/10 resize-none"
            />
            <div className="flex justify-end gap-3">
              <Button
                variant="ghost"
                onClick={() =>
                  setRejectDialog({ open: false, jobId: null, notes: "" })
                }
                className="rounded-xl"
              >
                Cancel
              </Button>
              <Button
                onClick={handleReject}
                disabled={!rejectDialog.notes.trim()}
                className="rounded-xl bg-red-600 hover:bg-red-700 text-white gap-2"
              >
                <Pencil className="h-4 w-4" />
                Reject &amp; Rewrite
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Generation Controls Bar (Higgsfield-style) ──
function GenerationControlsBar({
  quality,
  setQuality,
  aspectRatio,
  setAspectRatio,
  enhance,
  setEnhance,
  batchSize,
  setBatchSize,
  nsfwMode,
  setNsfwMode,
  isSoul,
}: {
  quality: string;
  setQuality: (v: string) => void;
  aspectRatio: string;
  setAspectRatio: (v: string) => void;
  enhance: boolean;
  setEnhance: (v: boolean) => void;
  batchSize: number;
  setBatchSize: (v: number) => void;
  nsfwMode: boolean;
  setNsfwMode: (v: boolean) => void;
  isSoul: boolean;
}) {
  const qualityOptions = isSoul
    ? ["1.5k", "2k"]
    : ["1k", "2k", "4k"];
  const aspectOptions = ["9:16", "3:4", "1:1", "4:3", "16:9"];

  const cycle = (opts: string[], cur: string, set: (v: string) => void) => {
    const i = opts.indexOf(cur);
    set(opts[(i + 1) % opts.length]);
  };

  return (
    <div className="glass-strong rounded-2xl p-2 flex items-center gap-2 flex-wrap">
      {/* Quality */}
      <button
        onClick={() => cycle(qualityOptions, quality, setQuality)}
        className="flex items-center gap-2 px-3 py-2 rounded-xl hover:bg-white/5 transition-colors text-sm"
      >
        <Gem className="h-4 w-4 text-brand" />
        <span className="font-medium">{quality}</span>
      </button>

      <div className="w-px h-6 bg-white/10" />

      {/* Aspect ratio */}
      <button
        onClick={() => cycle(aspectOptions, aspectRatio, setAspectRatio)}
        className="flex items-center gap-2 px-3 py-2 rounded-xl hover:bg-white/5 transition-colors text-sm"
      >
        <Smartphone className="h-4 w-4 text-muted-foreground" />
        <span className="font-medium">{aspectRatio}</span>
      </button>

      <div className="w-px h-6 bg-white/10" />

      {/* Prompt enhance */}
      <button
        onClick={() => setEnhance(!enhance)}
        className={`flex items-center gap-2 px-3 py-2 rounded-xl transition-colors text-sm ${
          enhance
            ? "bg-brand/15 text-brand"
            : "hover:bg-white/5 text-muted-foreground"
        }`}
      >
        <Wand className="h-4 w-4" />
        <span className="font-medium">Enhance {enhance ? "On" : "Off"}</span>
      </button>

      <div className="w-px h-6 bg-white/10" />

      {/* NSFW mode */}
      <button
        onClick={() => setNsfwMode(!nsfwMode)}
        className={`flex items-center gap-2 px-3 py-2 rounded-xl transition-colors text-sm ${
          nsfwMode
            ? "bg-red-500/15 text-red-300"
            : "hover:bg-white/5 text-muted-foreground"
        }`}
      >
        <Flame className="h-4 w-4" />
        <span className="font-medium">NSFW {nsfwMode ? "On" : "Off"}</span>
      </button>

      <div className="w-px h-6 bg-white/10" />

      {/* Batch size */}
      <div className="flex items-center gap-2 px-2 py-1 rounded-xl">
        <LayersIcon className="h-4 w-4 text-muted-foreground" />
        <button
          onClick={() => setBatchSize(Math.max(1, batchSize - 1))}
          className="h-6 w-6 rounded-md hover:bg-white/10 flex items-center justify-center text-lg leading-none"
        >
          −
        </button>
        <span className="font-medium text-sm w-8 text-center">{batchSize}/4</span>
        <button
          onClick={() => setBatchSize(Math.min(4, batchSize + 1))}
          className="h-6 w-6 rounded-md hover:bg-white/10 flex items-center justify-center text-lg leading-none"
        >
          +
        </button>
      </div>
    </div>
  );
}
