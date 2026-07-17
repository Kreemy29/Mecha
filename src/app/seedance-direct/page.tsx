"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  ImagePlus,
  Film,
  Play,
  Loader2,
  Download,
  Wand2,
} from "lucide-react";

interface Job {
  id: number;
  status: string;
  outputPath: string | null;
  error: string | null;
  attempts: number;
}

const fileUrl = (p: string) =>
  p.startsWith("http") ? p : `/api/files/${p.replace(/\\/g, "/")}`;
const isActive = (s: string) => ["queued", "running", "polling"].includes(s);

const statusColor: Record<string, string> = {
  queued: "bg-amber-500/10 text-amber-400 border-amber-500/20",
  running: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  polling: "bg-cyan-500/10 text-cyan-400 border-cyan-500/20",
  succeeded: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  failed: "bg-red-500/10 text-red-400 border-red-500/20",
  filtered: "bg-orange-500/10 text-orange-400 border-orange-500/20",
};

const ASPECTS = ["9:16", "1:1", "16:9"];

export default function SeedanceDirectPage() {
  const [imagePath, setImagePath] = useState<string | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [videoPath, setVideoPath] = useState<string | null>(null);
  const [videoDuration, setVideoDuration] = useState<number>(0);
  const [prompt, setPrompt] = useState("");

  const [provider, setProvider] = useState<"higgsfield" | "kie">("higgsfield");
  const [kieFast, setKieFast] = useState(true);
  const [aspectRatio, setAspectRatio] = useState("9:16");

  const [uploadingImage, setUploadingImage] = useState(false);
  const [uploadingVideo, setUploadingVideo] = useState(false);
  const [job, setJob] = useState<Job | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const imgInputRef = useRef<HTMLInputElement>(null);
  const vidInputRef = useRef<HTMLInputElement>(null);

  // Poll the job
  useEffect(() => {
    if (!job || !isActive(job.status)) return;
    const interval = setInterval(async () => {
      try {
        const res = await fetch("/api/jobs?limit=50");
        const all: Job[] = await res.json();
        const updated = all.find((j) => j.id === job.id);
        if (updated) setJob(updated);
      } catch {
        // silent
      }
    }, 2500);
    return () => clearInterval(interval);
  }, [job]);

  const uploadImage = useCallback(async (file: File) => {
    setUploadingImage(true);
    try {
      const form = new FormData();
      form.append("files", file);
      const res = await fetch("/api/references/upload", {
        method: "POST",
        body: form,
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      const r = data.results?.[0];
      if (!r?.path) throw new Error("Upload returned no path");
      setImagePath(r.path);
      setImageUrl(r.imageUrl);
      toast.success("Image reference set");
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Image upload failed");
    } finally {
      setUploadingImage(false);
    }
  }, []);

  const uploadVideo = useCallback(async (file: File) => {
    setUploadingVideo(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/references/video", {
        method: "POST",
        body: form,
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setVideoPath(data.videoPath);
      setVideoDuration(data.durationSeconds || 0);
      toast.success("Video reference set");
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Video upload failed");
    } finally {
      setUploadingVideo(false);
    }
  }, []);

  const canGenerate =
    imagePath && videoPath && prompt.trim().length >= 3 && !submitting;

  const generate = async () => {
    if (!canGenerate) return;
    setSubmitting(true);
    setJob(null);
    try {
      const res = await fetch("/api/seedance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          imagePath,
          videoPath,
          prompt,
          duration: videoDuration || undefined,
          aspectRatio,
          provider,
          fast: kieFast,
        }),
      });
      const created = await res.json();
      if (created.error) throw new Error(created.error);
      setJob(created);
      toast.success(
        `Submitted to ${provider === "kie" ? "KIE AI" : "Higgsfield"}`
      );
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to submit");
    } finally {
      setSubmitting(false);
    }
  };

  const who = provider === "kie" ? "KIE AI" : "Higgsfield";

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-3xl font-bold tracking-tight bg-gradient-to-r from-foreground to-foreground/60 bg-clip-text text-transparent">
          Seedance Direct
        </h2>
        <p className="text-sm text-muted-foreground mt-1">
          Drop an image reference + a video reference + a prompt &rarr; generate. No
          character pipeline, raw inputs straight to Seedance.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Image reference */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Image Reference</CardTitle>
          </CardHeader>
          <CardContent>
            <input
              ref={imgInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) uploadImage(f);
                e.target.value = "";
              }}
            />
            {imageUrl ? (
              <button
                onClick={() => imgInputRef.current?.click()}
                className="w-full rounded-xl overflow-hidden border border-white/10 hover:border-white/25 transition-all"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={imageUrl} alt="reference" className="w-full aspect-[3/4] object-cover" />
              </button>
            ) : (
              <Button
                onClick={() => imgInputRef.current?.click()}
                disabled={uploadingImage}
                variant="outline"
                className="w-full rounded-xl border-white/10 border-dashed h-40 gap-2 flex-col"
              >
                {uploadingImage ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  <ImagePlus className="h-5 w-5" />
                )}
                <span className="text-xs">Upload image</span>
              </Button>
            )}
          </CardContent>
        </Card>

        {/* Video reference */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">
              Video Reference
              {videoDuration > 0 && (
                <span className="text-muted-foreground font-normal"> · {videoDuration}s</span>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <input
              ref={vidInputRef}
              type="file"
              accept="video/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) uploadVideo(f);
                e.target.value = "";
              }}
            />
            {videoPath ? (
              <button
                onClick={() => vidInputRef.current?.click()}
                className="w-full rounded-xl overflow-hidden border border-white/10 hover:border-white/25 transition-all"
              >
                <video src={fileUrl(videoPath)} className="w-full aspect-[3/4] object-cover bg-black" muted />
              </button>
            ) : (
              <Button
                onClick={() => vidInputRef.current?.click()}
                disabled={uploadingVideo}
                variant="outline"
                className="w-full rounded-xl border-white/10 border-dashed h-40 gap-2 flex-col"
              >
                {uploadingVideo ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  <Film className="h-5 w-5" />
                )}
                <span className="text-xs">Upload video</span>
              </Button>
            )}
          </CardContent>
        </Card>

        {/* Prompt + controls */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Prompt &amp; Output</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={7}
              placeholder={
                provider === "kie"
                  ? "Describe the result. Reference the inputs as 'the reference image' and 'the reference video'."
                  : "Higgsfield: reference the inputs as @Image1 and @Video1 (e.g. DEFINE the woman in @Image1 as Subject 1...)."
              }
              className="glass border-white/10 resize-none text-xs"
            />

            {/* Provider */}
            <div className="glass rounded-xl p-1 flex text-sm w-fit">
              {(
                [
                  { key: "higgsfield", label: "Higgsfield" },
                  { key: "kie", label: "KIE AI" },
                ] as const
              ).map((p) => (
                <button
                  key={p.key}
                  onClick={() => setProvider(p.key)}
                  className={`px-3 py-1.5 rounded-lg transition-colors ${
                    provider === p.key
                      ? "bg-white/10 text-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>

            {provider === "kie" && (
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  checked={kieFast}
                  onChange={(e) => setKieFast(e.target.checked)}
                />
                Seedance 2 Fast (cheaper / quicker)
              </label>
            )}

            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Aspect</span>
              <div className="glass rounded-xl p-1 flex text-xs">
                {ASPECTS.map((a) => (
                  <button
                    key={a}
                    onClick={() => setAspectRatio(a)}
                    className={`px-2.5 py-1 rounded-lg transition-colors ${
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

            <Button
              onClick={generate}
              disabled={!canGenerate}
              className="w-full rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white gap-2"
            >
              {submitting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Play className="h-4 w-4" />
              )}
              Generate on {who}
            </Button>
            {!canGenerate && !submitting && (
              <p className="text-[11px] text-muted-foreground">
                Need an image, a video, and a prompt (3+ chars).
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Result */}
      {job && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                <Wand2 className="h-4 w-4" />
                Result — Job #{job.id}
              </CardTitle>
              <Badge className={`text-xs border ${statusColor[job.status] || ""}`}>
                {isActive(job.status) && <Loader2 className="h-3 w-3 animate-spin mr-1" />}
                {job.status}
              </Badge>
            </div>
            <p className="text-[11px] text-muted-foreground mt-1">
              {isActive(job.status)
                ? `🎬 generating on ${who} — video gen takes a few minutes`
                : job.status === "succeeded"
                  ? "✅ done"
                  : job.status === "failed"
                    ? `❌ ${job.error || "failed"}`
                    : job.status}
            </p>
          </CardHeader>
          <CardContent>
            {job.outputPath ? (
              <div className="space-y-2">
                <video
                  src={fileUrl(job.outputPath)}
                  controls
                  loop
                  autoPlay
                  className="w-full max-h-[70vh] rounded-xl bg-black"
                />
                <a
                  href={fileUrl(job.outputPath)}
                  download={`seedance-${job.id}.mp4`}
                  className="inline-flex items-center gap-2 text-xs text-[oklch(0.85_0.12_270)] hover:underline"
                >
                  <Download className="h-3.5 w-3.5" /> Download
                </a>
              </div>
            ) : (
              <div className="w-full aspect-video rounded-xl bg-white/5 flex items-center justify-center">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground/40" />
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
