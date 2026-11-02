"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ChevronRight, Folder, FolderPlus, HardDrive, Loader2, Download, CheckSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";

interface Entry {
  id: string;
  name: string;
  mimeType: string;
  isFolder: boolean;
}

export interface ImportedRef {
  imageUrl: string;
  thumbnailUrl: string;
  title: string;
  sourceUrl: string;
  path?: string;
}

// Browse one Drive (or shared folder) the way the team organised it, tick
// images, and import them as references. Folder structure is up to them;
// only the outputs side is fixed (outputs/<model>/<date>/).
export function DrivePicker({
  rootId,
  rootName,
  onImported,
}: {
  rootId: string;
  rootName: string;
  onImported: (refs: ImportedRef[]) => void;
}) {
  const [trail, setTrail] = useState<{ id: string; name: string }[]>([{ id: rootId, name: rootName }]);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [importing, setImporting] = useState(false);
  const [creating, setCreating] = useState(false);
  // Bumped to re-list the current folder (after making a folder in it).
  const [reload, setReload] = useState(0);

  const here = trail[trail.length - 1];

  const newFolder = async () => {
    const name = window.prompt(`New folder in "${here.name}":`)?.trim();
    if (!name) return;
    setCreating(true);
    try {
      const res = await fetch("/api/drive", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ parentId: here.id, name }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      toast.success(`Created "${data.name}"`);
      setReload((n) => n + 1);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't create the folder");
    } finally {
      setCreating(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/drive?folder=${encodeURIComponent(here.id)}`);
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        if (!cancelled) setEntries(data.entries || []);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Couldn't open this folder");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [here.id, reload]);

  const folders = entries.filter((e) => e.isFolder);
  const images = entries.filter((e) => !e.isFolder);
  const allHerePicked = images.length > 0 && images.every((i) => picked.has(i.id));

  const toggle = (id: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const toggleAllHere = () =>
    setPicked((prev) => {
      const next = new Set(prev);
      for (const i of images) {
        if (allHerePicked) next.delete(i.id);
        else next.add(i.id);
      }
      return next;
    });

  const importPicked = async () => {
    setImporting(true);
    try {
      const res = await fetch("/api/drive/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileIds: [...picked] }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      const refs: ImportedRef[] = data.results || [];
      onImported(refs);
      setPicked(new Set());
      if (data.failed?.length) toast.warning(`${data.failed.length} couldn't be imported: ${data.failed[0]}`);
      toast.success(`Imported ${refs.length} image${refs.length === 1 ? "" : "s"} from Drive`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Import failed");
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="rounded-xl border border-white/10 p-3 space-y-3">
      {/* Breadcrumb */}
      <div className="flex items-center gap-1 flex-wrap text-xs">
        {trail.map((t, i) => (
          <span key={t.id} className="flex items-center gap-1">
            {i > 0 && <ChevronRight className="h-3 w-3 text-muted-foreground" />}
            <button
              type="button"
              onClick={() => setTrail(trail.slice(0, i + 1))}
              disabled={i === trail.length - 1}
              className={`flex items-center gap-1 rounded px-1 py-0.5 ${
                i === trail.length - 1 ? "font-medium text-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {i === 0 && <HardDrive className="h-3 w-3" />}
              {t.name}
            </button>
          </span>
        ))}
        <div className="ml-auto flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={newFolder}
            disabled={creating || loading}
            className="h-7 rounded-lg border-white/10 gap-1.5 text-xs"
          >
            {creating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FolderPlus className="h-3.5 w-3.5" />}
            New folder
          </Button>
          {images.length > 0 && (
            <button type="button" onClick={toggleAllHere} className="text-muted-foreground hover:text-foreground">
              {allHerePicked ? "Unselect all here" : "Select all here"}
            </button>
          )}
          <Button
            size="sm"
            onClick={importPicked}
            disabled={picked.size === 0 || importing}
            className="h-7 rounded-lg bg-brand hover:bg-brand/90 text-brand-foreground gap-1.5 text-xs"
          >
            {importing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
            Import {picked.size || ""} selected
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 py-6 justify-center text-xs text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Opening folder…
        </div>
      ) : error ? (
        <p className="text-xs text-red-400 py-4 text-center">{error}</p>
      ) : (
        <>
          {folders.length > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2">
              {folders.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setTrail([...trail, { id: f.id, name: f.name }])}
                  className="flex items-center gap-2 rounded-lg glass px-2.5 py-2 text-left text-xs hover:bg-white/5"
                >
                  <Folder className="h-4 w-4 shrink-0 text-brand" />
                  <span className="truncate">{f.name}</span>
                </button>
              ))}
            </div>
          )}
          {images.length > 0 ? (
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-2">
              {images.map((img) => (
                <button
                  key={img.id}
                  type="button"
                  onClick={() => toggle(img.id)}
                  title={img.name}
                  className={`relative aspect-square overflow-hidden rounded-lg border-2 transition-all ${
                    picked.has(img.id) ? "border-brand" : "border-transparent hover:border-white/20"
                  }`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={`/api/drive/thumb?id=${encodeURIComponent(img.id)}`}
                    alt={img.name}
                    loading="lazy"
                    className="h-full w-full object-cover bg-white/5"
                  />
                  <div className="absolute top-1 right-1">
                    <Checkbox
                      checked={picked.has(img.id)}
                      className="border-white/50 data-[state=checked]:bg-brand data-[state=checked]:border-brand"
                    />
                  </div>
                </button>
              ))}
            </div>
          ) : (
            folders.length === 0 && (
              <p className="text-xs text-muted-foreground py-4 text-center">No images or folders here.</p>
            )
          )}
          {picked.size > 0 && (
            <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <CheckSquare className="h-3 w-3" /> {picked.size} selected (you can keep picking in other folders)
            </p>
          )}
        </>
      )}
    </div>
  );
}
