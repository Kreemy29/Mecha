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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import {
  Plus,
  Pencil,
  Trash2,
  Layers,
  Image,
  Video,
  Sparkles,
  Power,
  PowerOff,
} from "lucide-react";

interface Preset {
  id: number;
  name: string;
  description: string | null;
  type: "image" | "video";
  searchPromptSeed: string;
  active: boolean;
  createdAt: string;
}

export default function PresetsPage() {
  const [presets, setPresets] = useState<Preset[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState({
    name: "",
    description: "",
    type: "image" as "image" | "video",
    searchPromptSeed: "",
  });

  const fetchPresets = useCallback(async () => {
    try {
      const res = await fetch("/api/presets");
      setPresets(await res.json());
    } catch {
      toast.error("Failed to load presets");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPresets();
  }, [fetchPresets]);

  const seedPresets = async () => {
    try {
      const res = await fetch("/api/presets/seed", { method: "POST" });
      const data = await res.json();
      toast.success(data.message);
      fetchPresets();
    } catch {
      toast.error("Failed to seed presets");
    }
  };

  const resetForm = () => {
    setForm({ name: "", description: "", type: "image", searchPromptSeed: "" });
    setEditingId(null);
  };

  const openCreate = () => {
    resetForm();
    setDialogOpen(true);
  };

  const openEdit = (p: Preset) => {
    setForm({
      name: p.name,
      description: p.description || "",
      type: p.type,
      searchPromptSeed: p.searchPromptSeed,
    });
    setEditingId(p.id);
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!form.name.trim() || !form.searchPromptSeed.trim()) {
      toast.error("Name and search prompt seed are required");
      return;
    }

    try {
      if (editingId) {
        await fetch(`/api/presets/${editingId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(form),
        });
        toast.success("Preset updated");
      } else {
        await fetch("/api/presets", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(form),
        });
        toast.success("Preset created");
      }
      setDialogOpen(false);
      resetForm();
      fetchPresets();
    } catch {
      toast.error("Failed to save preset");
    }
  };

  const toggleActive = async (p: Preset) => {
    try {
      await fetch(`/api/presets/${p.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: !p.active }),
      });
      toast.success(p.active ? "Preset deactivated" : "Preset activated");
      fetchPresets();
    } catch {
      toast.error("Failed to update preset");
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await fetch(`/api/presets/${id}`, { method: "DELETE" });
      toast.success("Preset deleted");
      fetchPresets();
    } catch {
      toast.error("Failed to delete preset");
    }
  };

  return (
    <div className="space-y-8">
      <div className="flex items-end justify-between">
        <div>
          <h2 className="text-3xl font-bold tracking-tight bg-gradient-to-r from-foreground to-foreground/60 bg-clip-text text-transparent">
            Presets
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            Generation preset categories for search prompt expansion
          </p>
        </div>
        <div className="flex gap-2">
          {presets.length === 0 && (
            <Button
              onClick={seedPresets}
              size="sm"
              variant="ghost"
              className="gap-2 rounded-xl text-muted-foreground hover:text-foreground"
            >
              <Sparkles className="h-4 w-4" />
              Seed Defaults
            </Button>
          )}
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
              New Preset
            </DialogTrigger>
            <DialogContent className="glass-strong border-white/10 sm:max-w-lg">
              <DialogHeader>
                <DialogTitle>
                  {editingId ? "Edit Preset" : "Create Preset"}
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
                    placeholder="e.g. Outdoor Portrait"
                    className="glass border-white/10"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    Type
                  </label>
                  <Select
                    value={form.type}
                    onValueChange={(v) =>
                      setForm((f) => ({
                        ...f,
                        type: v as "image" | "video",
                      }))
                    }
                  >
                    <SelectTrigger className="glass border-white/10">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="glass-strong border-white/10">
                      <SelectItem value="image">Image</SelectItem>
                      <SelectItem value="video">Video</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    Description
                  </label>
                  <Input
                    value={form.description}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, description: e.target.value }))
                    }
                    placeholder="Brief description of the preset style"
                    className="glass border-white/10"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    Search Prompt Seed
                  </label>
                  <Textarea
                    value={form.searchPromptSeed}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        searchPromptSeed: e.target.value,
                      }))
                    }
                    placeholder="Base keywords Grok will expand into varied search queries"
                    rows={3}
                    className="glass border-white/10 resize-none"
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
                <div className="h-12 w-full rounded bg-white/5" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : presets.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16">
            <div className="p-4 rounded-2xl glass mb-4">
              <Layers className="h-8 w-8 text-muted-foreground" />
            </div>
            <p className="text-sm text-muted-foreground mb-4">
              No presets yet. Seed defaults or create your own.
            </p>
            <div className="flex gap-2">
              <Button
                onClick={seedPresets}
                size="sm"
                variant="outline"
                className="rounded-xl gap-2 border-white/10"
              >
                <Sparkles className="h-4 w-4" />
                Seed Defaults
              </Button>
              <Button
                onClick={openCreate}
                size="sm"
                className="rounded-xl bg-[oklch(0.75_0.15_270)] hover:bg-[oklch(0.7_0.15_270)] text-white gap-2"
              >
                <Plus className="h-4 w-4" />
                Create Preset
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {presets.map((p) => (
            <Card
              key={p.id}
              className={`group relative ${!p.active ? "opacity-50" : ""}`}
            >
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div
                      className={`p-2 rounded-lg ${
                        p.type === "image"
                          ? "bg-blue-500/10"
                          : "bg-emerald-500/10"
                      }`}
                    >
                      {p.type === "image" ? (
                        <Image className="h-4 w-4 text-blue-400" />
                      ) : (
                        <Video className="h-4 w-4 text-emerald-400" />
                      )}
                    </div>
                    <div>
                      <CardTitle className="text-base">{p.name}</CardTitle>
                      {p.description && (
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {p.description}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 rounded-lg hover:bg-white/10"
                      onClick={() => toggleActive(p)}
                      title={p.active ? "Deactivate" : "Activate"}
                    >
                      {p.active ? (
                        <Power className="h-3.5 w-3.5 text-emerald-400" />
                      ) : (
                        <PowerOff className="h-3.5 w-3.5" />
                      )}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 rounded-lg hover:bg-white/10"
                      onClick={() => openEdit(p)}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 rounded-lg hover:bg-red-500/10 hover:text-red-400"
                      onClick={() => handleDelete(p.id)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge
                    variant="outline"
                    className="text-xs border-white/10 bg-white/5"
                  >
                    {p.type}
                  </Badge>
                  {p.active ? (
                    <Badge className="text-xs bg-emerald-500/10 text-emerald-400 border-emerald-500/20 border">
                      Active
                    </Badge>
                  ) : (
                    <Badge className="text-xs bg-white/5 text-muted-foreground border-white/10 border">
                      Inactive
                    </Badge>
                  )}
                </div>
                <div className="mt-3 p-2 rounded-lg bg-white/3 border border-white/5">
                  <p className="text-xs text-muted-foreground font-mono leading-relaxed">
                    {p.searchPromptSeed}
                  </p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
