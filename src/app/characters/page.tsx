"use client";

import { useEffect, useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  Plus,
  Pencil,
  Trash2,
  Users,
  Fingerprint,
  RefreshCw,
  Loader2,
  Sparkles,
  Upload,
  X,
  Wand2,
} from "lucide-react";

interface Character {
  id: number;
  name: string;
  featureProfile: string;
  higgsFieldCharacterRef: string | null;
  baseImagePath: string | null;
  createdAt: string;
}

export default function CharactersPage() {
  const [characters, setCharacters] = useState<Character[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState({
    name: "",
    featureProfile: "",
    higgsFieldCharacterRef: "",
  });

  const fetchCharacters = useCallback(async () => {
    try {
      const res = await fetch("/api/characters");
      setCharacters(await res.json());
    } catch {
      toast.error("Failed to load characters");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCharacters();
  }, [fetchCharacters]);

  const resetForm = () => {
    setForm({ name: "", featureProfile: "", higgsFieldCharacterRef: "" });
    setEditingId(null);
  };

  const openCreate = () => {
    resetForm();
    setDialogOpen(true);
  };

  const openEdit = (c: Character) => {
    setForm({
      name: c.name,
      featureProfile: c.featureProfile,
      higgsFieldCharacterRef: c.higgsFieldCharacterRef || "",
    });
    setEditingId(c.id);
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!form.name.trim() || !form.featureProfile.trim()) {
      toast.error("Name and feature profile are required");
      return;
    }

    try {
      if (editingId) {
        await fetch(`/api/characters/${editingId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(form),
        });
        toast.success("Character updated");
      } else {
        await fetch("/api/characters", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(form),
        });
        toast.success("Character created");
      }
      setDialogOpen(false);
      resetForm();
      fetchCharacters();
    } catch {
      toast.error("Failed to save character");
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await fetch(`/api/characters/${id}`, { method: "DELETE" });
      toast.success("Character deleted");
      fetchCharacters();
    } catch {
      toast.error("Failed to delete character");
    }
  };

  return (
    <div className="space-y-8">
      <div className="flex items-end justify-between">
        <div>
          <h2 className="text-3xl font-bold tracking-tight bg-gradient-to-r from-foreground to-foreground/60 bg-clip-text text-transparent">
            Characters
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            Manage AI personas for content generation
          </p>
        </div>
        <div className="flex gap-2">
          <AiCharacterCreator onCreated={fetchCharacters} />
          <SyncHiggsFieldButton onSync={fetchCharacters} />
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger
              render={
                <Button
                  onClick={openCreate}
                  size="sm"
                  className="glass-strong border-white/10 bg-[oklch(0.75_0.15_270_/_10%)] hover:bg-[oklch(0.75_0.15_270_/_20%)] text-foreground gap-2 rounded-xl"
                />
              }
            >
              <Plus className="h-4 w-4" />
              New Character
            </DialogTrigger>
          <DialogContent className="glass-strong border-white/10 sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>
                {editingId ? "Edit Character" : "Create Character"}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4 pt-2">
              <div className="space-y-2">
                <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Name
                </label>
                <Input
                  value={form.name}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, name: e.target.value }))
                  }
                  placeholder="e.g. Luna Vega"
                  className="glass border-white/10"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Feature Profile
                </label>
                <Textarea
                  value={form.featureProfile}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, featureProfile: e.target.value }))
                  }
                  placeholder="Detailed physical/style description injected into recreation prompts. e.g. 'Mid-20s woman, warm olive skin, dark wavy hair past shoulders, angular jawline, minimal makeup, modern streetwear aesthetic...'"
                  rows={6}
                  className="glass border-white/10 resize-none"
                />
                <p className="text-xs text-muted-foreground">
                  This is injected into every recreation prompt for identity
                  consistency.
                </p>
              </div>
              <div className="space-y-2">
                <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Higgsfield Character Ref
                </label>
                <Input
                  value={form.higgsFieldCharacterRef}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      higgsFieldCharacterRef: e.target.value,
                    }))
                  }
                  placeholder="Optional — linked after first generation"
                  className="glass border-white/10"
                />
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <Button
                  variant="ghost"
                  onClick={() => setDialogOpen(false)}
                  className="rounded-xl"
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleSave}
                  className="rounded-xl bg-[oklch(0.75_0.15_270)] hover:bg-[oklch(0.7_0.15_270)] text-white"
                >
                  {editingId ? "Update" : "Create"}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
        </div>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <Card key={i} className="animate-pulse">
              <CardContent className="pt-6 space-y-3">
                <div className="h-5 w-32 rounded bg-white/5" />
                <div className="h-20 w-full rounded bg-white/5" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : characters.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16">
            <div className="p-4 rounded-2xl glass mb-4">
              <Users className="h-8 w-8 text-muted-foreground" />
            </div>
            <p className="text-sm text-muted-foreground mb-4">
              No characters yet. Create your first AI persona.
            </p>
            <Button
              onClick={openCreate}
              size="sm"
              className="rounded-xl bg-[oklch(0.75_0.15_270)] hover:bg-[oklch(0.7_0.15_270)] text-white gap-2"
            >
              <Plus className="h-4 w-4" />
              Create Character
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {characters.map((c) => (
            <Card key={c.id} className="group relative overflow-hidden p-0">
              {/* Thumbnail banner */}
              <div className="relative aspect-[4/3] w-full overflow-hidden bg-white/5">
                {c.baseImagePath ? (
                  <img
                    src={
                      c.baseImagePath.startsWith("http")
                        ? c.baseImagePath
                        : `/api/files/${c.baseImagePath}`
                    }
                    alt={c.name}
                    className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                    loading="lazy"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center">
                    <Users className="h-10 w-10 text-muted-foreground/30" />
                  </div>
                )}
                <div className="absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-black/80 to-transparent" />
                <div className="absolute bottom-2 left-3 right-3">
                  <h3 className="text-base font-semibold drop-shadow">{c.name}</h3>
                </div>
                {/* Hover actions */}
                <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 rounded-lg glass-strong hover:bg-white/20"
                    onClick={() => openEdit(c)}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 rounded-lg glass-strong hover:bg-red-500/30 hover:text-red-300"
                    onClick={() => handleDelete(c.id)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
              <CardContent className="space-y-3 p-4">
                <p className="text-xs text-muted-foreground leading-relaxed line-clamp-3">
                  {c.featureProfile}
                </p>
                {c.higgsFieldCharacterRef && (
                  <Badge
                    variant="outline"
                    className="text-xs border-white/10 bg-white/5 gap-1.5 max-w-full"
                  >
                    <Fingerprint className="h-3 w-3 shrink-0" />
                    <span className="truncate">{c.higgsFieldCharacterRef}</span>
                  </Badge>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function SyncHiggsFieldButton({ onSync }: { onSync: () => void }) {
  const [syncing, setSyncing] = useState(false);

  const handleSync = async () => {
    setSyncing(true);
    try {
      const res = await fetch("/api/higgsfield/characters", { method: "POST" });
      const data = await res.json();
      if (data.error) {
        toast.error(data.error);
      } else {
        toast.success(data.message);
        onSync();
      }
    } catch {
      toast.error("Failed to sync from Higgsfield");
    } finally {
      setSyncing(false);
    }
  };

  return (
    <Button
      onClick={handleSync}
      disabled={syncing}
      size="sm"
      variant="outline"
      className="rounded-xl border-white/10 gap-2 text-muted-foreground hover:text-foreground"
    >
      {syncing ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        <RefreshCw className="h-4 w-4" />
      )}
      Sync from Higgsfield
    </Button>
  );
}

// ── AI Character Creator — composite a unique persona from 2-4 face pics ──
function AiCharacterCreator({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [images, setImages] = useState<string[]>([]); // data URIs
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<{ name: string; featureProfile: string } | null>(
    null
  );

  const reset = () => {
    setImages([]);
    setResult(null);
    setGenerating(false);
    setSaving(false);
  };

  const handleFiles = (files: FileList | null) => {
    if (!files) return;
    const remaining = 4 - images.length;
    const toRead = Array.from(files).slice(0, remaining);
    toRead.forEach((file) => {
      if (!file.type.startsWith("image/")) return;
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === "string") {
          setImages((prev) => (prev.length < 4 ? [...prev, reader.result as string] : prev));
        }
      };
      reader.readAsDataURL(file);
    });
  };

  const removeImage = (i: number) =>
    setImages((prev) => prev.filter((_, j) => j !== i));

  const handleGenerate = async () => {
    if (images.length < 2) {
      toast.error("Upload at least 2 face references");
      return;
    }
    setGenerating(true);
    try {
      const res = await fetch("/api/grok/character-profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ images }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setResult({ name: data.name, featureProfile: data.featureProfile });
      toast.success("Identity generated");
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Generation failed");
    } finally {
      setGenerating(false);
    }
  };

  const handleSave = async () => {
    if (!result) return;
    setSaving(true);
    try {
      await fetch("/api/characters", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: result.name,
          featureProfile: result.featureProfile,
        }),
      });
      toast.success(`Created character "${result.name}"`);
      setOpen(false);
      reset();
      onCreated();
    } catch {
      toast.error("Failed to save character");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) reset();
      }}
    >
      <DialogTrigger
        render={
          <Button
            size="sm"
            variant="outline"
            className="rounded-xl border-white/10 gap-2 text-[oklch(0.85_0.12_270)]"
          />
        }
      >
        <Sparkles className="h-4 w-4" />
        AI Creator
      </DialogTrigger>
      <DialogContent className="glass-strong border-white/10 sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Wand2 className="h-4 w-4 text-[oklch(0.85_0.12_270)]" />
            AI Character Creator
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          <p className="text-xs text-muted-foreground">
            Upload 2–4 face references. Grok blends their features randomly into one
            unique fictional persona that resembles none of them exactly.
          </p>

          {/* Upload grid */}
          <div className="grid grid-cols-4 gap-2">
            {images.map((src, i) => (
              <div
                key={i}
                className="relative aspect-square rounded-lg overflow-hidden group"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={src} alt={`ref ${i + 1}`} className="h-full w-full object-cover" />
                <button
                  onClick={() => removeImage(i)}
                  className="absolute top-1 right-1 h-5 w-5 rounded-full bg-black/60 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
            {images.length < 4 && (
              <label className="aspect-square rounded-lg border border-dashed border-white/15 flex items-center justify-center cursor-pointer hover:bg-white/5 transition-colors">
                <Upload className="h-5 w-5 text-muted-foreground" />
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={(e) => handleFiles(e.target.files)}
                />
              </label>
            )}
          </div>

          {!result ? (
            <Button
              onClick={handleGenerate}
              disabled={generating || images.length < 2}
              className="w-full rounded-xl bg-[oklch(0.75_0.15_270)] hover:bg-[oklch(0.7_0.15_270)] text-white gap-2"
            >
              {generating ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="h-4 w-4" />
              )}
              {generating ? "Blending identity..." : "Generate Identity"}
            </Button>
          ) : (
            <div className="space-y-3">
              <div className="space-y-2">
                <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Name
                </label>
                <Input
                  value={result.name}
                  onChange={(e) =>
                    setResult((r) => (r ? { ...r, name: e.target.value } : r))
                  }
                  className="glass border-white/10"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Generated Identity
                </label>
                <Textarea
                  value={result.featureProfile}
                  onChange={(e) =>
                    setResult((r) =>
                      r ? { ...r, featureProfile: e.target.value } : r
                    )
                  }
                  rows={8}
                  className="glass border-white/10 resize-none text-sm"
                />
              </div>
              <div className="flex gap-2">
                <Button
                  variant="ghost"
                  onClick={handleGenerate}
                  disabled={generating}
                  className="rounded-xl gap-2"
                >
                  {generating ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <RefreshCw className="h-4 w-4" />
                  )}
                  Re-blend
                </Button>
                <Button
                  onClick={handleSave}
                  disabled={saving}
                  className="flex-1 rounded-xl bg-[oklch(0.75_0.15_270)] hover:bg-[oklch(0.7_0.15_270)] text-white gap-2"
                >
                  {saving ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Plus className="h-4 w-4" />
                  )}
                  Save Character
                </Button>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
