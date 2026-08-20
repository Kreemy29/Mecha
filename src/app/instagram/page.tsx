"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import {
  Plus,
  Loader2,
  Trash2,
  RefreshCw,
  Play,
  Heart,
  MessageCircle,
  Bookmark,
  BookmarkCheck,
  Clapperboard,
  Shirt,
  Download,
  Users,
  Film,
  Tag,
  Pencil,
  ChevronRight,
  Megaphone,
  X,
} from "lucide-react";
import { InstagramIcon } from "@/components/icons";
import { cn } from "@/lib/utils";

interface IgAccount {
  id: number;
  username: string;
  fullName: string | null;
  biography: string | null;
  profilePicPath: string | null;
  followerCount: number | null;
  mediaCount: number | null;
  models: string[];
  niches: string[];
  lastSyncedAt: string | null;
}

// How the rail buckets accounts.
type GroupBy = "niche" | "model";
const UNASSIGNED = "Unassigned";

// What the library is currently showing.
type Scope =
  | { kind: "all" }
  | { kind: "model"; value: string }
  | { kind: "niche"; value: string };

// A live feed item from the API (not yet persisted).
interface FeedItem {
  pk: string;
  shortcode: string;
  thumbnailUrl: string;
  caption: string;
  playCount: number | null;
  likeCount: number | null;
  commentCount: number | null;
  takenAt: number | null;
  saved: boolean;
}

// A persisted (saved) media row.
interface SavedItem {
  id: number;
  accountId: number | null;
  shortcode: string;
  caption: string | null;
  thumbPath: string | null;
  videoPath: string | null;
  playCount: number | null;
  likeCount: number | null;
  commentCount: number | null;
  takenAt: number | null;
  durationSeconds: number | null;
}

type Tab = "reels" | "saved";

// The two work queues a clip can be handed to.
type Queue = "meta_ads" | "reels";
const QUEUE_LABEL: Record<Queue, string> = {
  meta_ads: "Meta Ads",
  reels: "Instagram Reels",
};

// A saved format, offered as the recipe a request should be made with.
interface FormatOption {
  id: number;
  name: string;
}


const fileUrl = (p: string) => `/api/files/${p.replace(/\\/g, "/")}`;
const proxied = (url: string) =>
  `/api/instagram/image?url=${encodeURIComponent(url)}`;

const compact = (n: number | null): string => {
  if (n === null || n === undefined) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, "")}K`;
  return String(n);
};

const timeAgo = (unixSeconds: number | null): string => {
  if (!unixSeconds) return "";
  const s = Math.floor(Date.now() / 1000) - unixSeconds;
  if (s < 3600) return `${Math.max(1, Math.floor(s / 60))}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)}d ago`;
  return `${Math.floor(s / (86400 * 30))}mo ago`;
};

export default function InstagramPage() {
  const router = useRouter();

  const [accounts, setAccounts] = useState<IgAccount[]>([]);
  const [selected, setSelected] = useState<IgAccount | null>(null);
  const [adding, setAdding] = useState(false);

  // Add / retag form — an account can carry several models and several niches.
  const [formOpen, setFormOpen] = useState(false);
  const [newUsername, setNewUsername] = useState("");
  const [newModels, setNewModels] = useState<string[]>([]);
  const [newNiches, setNewNiches] = useState<string[]>([]);
  const [editing, setEditing] = useState<IgAccount | null>(null);

  // Remembered options, offered as presets on the form.
  const [options, setOptions] = useState<{ models: string[]; niches: string[] }>({
    models: [],
    niches: [],
  });

  // Rail grouping
  const [groupBy, setGroupBy] = useState<GroupBy>("niche");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const [tab, setTab] = useState<Tab>("reels");
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [nextMaxId, setNextMaxId] = useState<string | null>(null);
  const [loadingFeed, setLoadingFeed] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [savedItems, setSavedItems] = useState<SavedItem[]>([]);

  // "browse" = one account's feed; "library" = saved videos (all, or scoped to
  // a single model / niche).
  const [mode, setMode] = useState<"browse" | "library">("browse");
  const [library, setLibrary] = useState<SavedItem[]>([]);
  const [loadingLibrary, setLoadingLibrary] = useState(false);
  const [scope, setScope] = useState<Scope>({ kind: "all" });
  // Total across everything, for the rail's counter (independent of scope).
  const [totalSaved, setTotalSaved] = useState(0);

  // shortcode → what's currently happening to it ("saving" | "downloading")
  const [busy, setBusy] = useState<Record<string, string>>({});

  // ── Assign to a work queue ──
  const [assignFor, setAssignFor] = useState<FeedItem | SavedItem | null>(null);
  const [assignQueue, setAssignQueue] = useState<Queue>("meta_ads");
  const [assignComment, setAssignComment] = useState("");
  const [assignModel, setAssignModel] = useState("");
  const [assignFormatId, setAssignFormatId] = useState<number | null>(null);
  const [assigning, setAssigning] = useState(false);
  const [formats, setFormats] = useState<FormatOption[]>([]);

  const loadAccounts = useCallback(async () => {
    const res = await fetch("/api/instagram/accounts");
    const rows: IgAccount[] = await res.json();
    setAccounts(rows);
    return rows;
  }, []);

  const loadOptions = useCallback(async () => {
    const res = await fetch("/api/instagram/taxonomy");
    setOptions(await res.json());
  }, []);

  useEffect(() => {
    loadAccounts();
    loadOptions();
    fetch("/api/prompt-presets")
      .then((r) => r.json())
      .then((rows: FormatOption[]) => Array.isArray(rows) && setFormats(rows))
      .catch(() => {});
  }, [loadAccounts, loadOptions]);

  const openAssign = (item: FeedItem | SavedItem) => setAssignFor(item);

  const loadFeed = useCallback(async (account: IgAccount) => {
    setLoadingFeed(true);
    setFeed([]);
    setNextMaxId(null);
    try {
      const res = await fetch(
        `/api/instagram/feed?username=${encodeURIComponent(account.username)}`
      );
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setFeed(data.items);
      setNextMaxId(data.nextMaxId);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to load feed");
    } finally {
      setLoadingFeed(false);
    }
  }, []);

  const loadSaved = useCallback(async (account: IgAccount) => {
    const res = await fetch(`/api/instagram/media?accountId=${account.id}`);
    setSavedItems(await res.json());
  }, []);

  // Saved videos for a scope: everything, or just one model / niche. Media
  // inherits its account's tags, so a clip appears under every model and niche
  // its source account belongs to.
  const loadLibrary = useCallback(async (next: Scope) => {
    setLoadingLibrary(true);
    try {
      const qs =
        next.kind === "all"
          ? ""
          : `?${next.kind}=${encodeURIComponent(next.value)}`;
      const res = await fetch(`/api/instagram/media${qs}`);
      const rows: SavedItem[] = await res.json();
      setLibrary(rows);
      if (next.kind === "all") setTotalSaved(rows.length);
    } catch {
      toast.error("Failed to load saved videos");
    } finally {
      setLoadingLibrary(false);
    }
  }, []);

  // Keep the rail's total accurate regardless of what the library is showing.
  const refreshTotal = useCallback(async () => {
    const res = await fetch("/api/instagram/media");
    const rows: SavedItem[] = await res.json();
    setTotalSaved(rows.length);
    return rows;
  }, []);

  useEffect(() => {
    refreshTotal();
  }, [refreshTotal]);

  const openLibrary = useCallback(
    (next: Scope = { kind: "all" }) => {
      setMode("library");
      setSelected(null);
      setScope(next);
      loadLibrary(next);
    },
    [loadLibrary]
  );

  const selectAccount = useCallback(
    (account: IgAccount) => {
      setMode("browse");
      setSelected(account);
      setTab("reels");
      loadFeed(account);
      loadSaved(account);
    },
    [loadFeed, loadSaved]
  );

  const openAddForm = () => {
    setEditing(null);
    setNewUsername("");
    setNewModels([]);
    setNewNiches([]);
    setFormOpen(true);
  };

  const openEditForm = (account: IgAccount) => {
    setEditing(account);
    setNewUsername(account.username);
    setNewModels(account.models ?? []);
    setNewNiches(account.niches ?? []);
    setFormOpen(true);
  };

  const closeForm = () => {
    setFormOpen(false);
    setEditing(null);
    setNewUsername("");
    setNewModels([]);
    setNewNiches([]);
  };

  // One submit path for both "add a new account" and "retag an existing one".
  const submitForm = async () => {
    const username = newUsername.trim().replace(/^@/, "");
    if (!username) return;
    setAdding(true);
    try {
      const res = await fetch("/api/instagram/accounts", {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          editing
            ? { id: editing.id, models: newModels, niches: newNiches }
            : { username, models: newModels, niches: newNiches }
        ),
      });
      const row = await res.json();
      if (row.error) throw new Error(row.error);

      await Promise.all([loadAccounts(), loadOptions()]);
      closeForm();
      if (editing) {
        if (selected?.id === row.id) setSelected(row);
        toast.success(`Updated @${row.username}`);
      } else {
        selectAccount(row);
        toast.success(`Added @${row.username}`);
      }
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to save account");
    } finally {
      setAdding(false);
    }
  };

  const refreshAccount = async (account: IgAccount) => {
    try {
      const res = await fetch("/api/instagram/accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: account.username }),
      });
      const row = await res.json();
      if (row.error) throw new Error(row.error);
      await loadAccounts();
      setSelected(row);
      loadFeed(row);
      toast.success(`Refreshed @${row.username}`);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Refresh failed");
    }
  };

  const removeAccount = async (account: IgAccount) => {
    await fetch(`/api/instagram/accounts?id=${account.id}`, { method: "DELETE" });
    if (selected?.id === account.id) {
      setSelected(null);
      setFeed([]);
      setSavedItems([]);
    }
    loadAccounts();
  };

  const loadMore = async () => {
    if (!selected || !nextMaxId) return;
    setLoadingMore(true);
    try {
      const res = await fetch(
        `/api/instagram/feed?username=${encodeURIComponent(
          selected.username
        )}&maxId=${encodeURIComponent(nextMaxId)}`
      );
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setFeed((prev) => {
        const seen = new Set(prev.map((i) => i.shortcode));
        return [
          ...prev,
          ...data.items.filter((i: FeedItem) => !seen.has(i.shortcode)),
        ];
      });
      setNextMaxId(data.nextMaxId);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to load more");
    } finally {
      setLoadingMore(false);
    }
  };

  // Save a live feed item → returns the persisted row.
  const saveItem = async (item: FeedItem): Promise<SavedItem> => {
    const res = await fetch("/api/instagram/media", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accountId: selected?.id, item }),
    });
    const row = await res.json();
    if (row.error) throw new Error(row.error);
    setFeed((prev) =>
      prev.map((f) => (f.shortcode === item.shortcode ? { ...f, saved: true } : f))
    );
    if (selected) loadSaved(selected);
    refreshTotal();
    return row;
  };

  const toggleSave = async (item: FeedItem) => {
    setBusy((b) => ({ ...b, [item.shortcode]: "saving" }));
    try {
      if (item.saved) {
        await fetch(`/api/instagram/media?shortcode=${item.shortcode}`, {
          method: "DELETE",
        });
        setFeed((prev) =>
          prev.map((f) =>
            f.shortcode === item.shortcode ? { ...f, saved: false } : f
          )
        );
        if (selected) loadSaved(selected);
        refreshTotal();
      } else {
        await saveItem(item);
        toast.success("Saved");
      }
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Save failed");
    } finally {
      setBusy((b) => {
        const { [item.shortcode]: _drop, ...rest } = b;
        return rest;
      });
    }
  };

  // Download the video (saving first if needed) and jump to a recreation page.
  // Hand a clip to a work queue. A feed item is saved first — a request has to
  // point at a persisted row, and saving is what the operator would do anyway.
  const submitAssign = async () => {
    if (!assignFor) return;
    setAssigning(true);
    try {
      const saved: SavedItem =
        "id" in assignFor ? assignFor : await saveItem(assignFor);
      const res = await fetch("/api/instagram/requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mediaId: saved.id,
          queue: assignQueue,
          comment: assignComment,
          model: assignModel || null,
          formatId: assignFormatId,
        }),
      });
      const row = await res.json();
      if (row.error) throw new Error(row.error);
      toast.success(`Assigned to ${QUEUE_LABEL[assignQueue]}`);
      setAssignFor(null);
      setAssignComment("");
      setAssignModel("");
      setAssignFormatId(null);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Assign failed");
    } finally {
      setAssigning(false);
    }
  };

  const recreate = async (
    source: FeedItem | SavedItem,
    target: "seedance" | "motion-capture"
  ) => {
    const shortcode = source.shortcode;
    setBusy((b) => ({ ...b, [shortcode]: "downloading" }));
    try {
      let saved: SavedItem;
      if ("id" in source) {
        saved = source;
      } else {
        saved = await saveItem(source);
      }
      const res = await fetch(`/api/instagram/media/${saved.id}/download`, {
        method: "POST",
      });
      const row: SavedItem & { error?: string } = await res.json();
      if (row.error) throw new Error(row.error);
      if (!row.videoPath) throw new Error("Download returned no video");

      // In the library the cards come from different accounts, so name the
      // import after the row's own account rather than whatever is selected.
      const owner =
        "id" in source
          ? usernameFor(source.accountId)
          : (selected?.username ?? "ig");
      const name = `@${owner}/${shortcode}`;
      const params = new URLSearchParams({
        import: row.videoPath,
        name,
        duration: String(row.durationSeconds ?? 0),
      });
      router.push(`/${target}?${params.toString()}`);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Download failed");
      setBusy((b) => {
        const { [shortcode]: _drop, ...rest } = b;
        return rest;
      });
    }
  };

  const removeSaved = async (item: SavedItem) => {
    await fetch(`/api/instagram/media?id=${item.id}`, { method: "DELETE" });
    if (selected) loadSaved(selected);
    setLibrary((prev) => prev.filter((i) => i.id !== item.id));
    refreshTotal();
    setFeed((prev) =>
      prev.map((f) =>
        f.shortcode === item.shortcode ? { ...f, saved: false } : f
      )
    );
  };

  // @username for a saved row — the library mixes accounts, so each card says
  // where it came from.
  const usernameFor = (accountId: number | null): string =>
    accounts.find((a) => a.id === accountId)?.username ?? "ig";

  // Bucket accounts by the active dimension. An account carrying several tags
  // appears under each of them; untagged ones fall into "Unassigned", which
  // always sorts last.
  const groups = useMemo(() => {
    const map = new Map<string, IgAccount[]>();
    const push = (key: string, a: IgAccount) => {
      const bucket = map.get(key);
      if (bucket) bucket.push(a);
      else map.set(key, [a]);
    };
    for (const a of accounts) {
      const tags = (groupBy === "niche" ? a.niches : a.models) ?? [];
      if (tags.length === 0) push(UNASSIGNED, a);
      else for (const t of tags) push(t, a);
    }
    return [...map.entries()].sort(([a], [b]) => {
      if (a === UNASSIGNED) return 1;
      if (b === UNASSIGNED) return -1;
      return a.localeCompare(b);
    });
  }, [accounts, groupBy]);

  return (
    <div className="flex gap-6 items-start">
      {/* ── Left rail: saved models ── */}
      <aside className="w-64 shrink-0 space-y-3 sticky top-24">
        <div>
          <h2 className="text-xl font-bold tracking-tight flex items-center gap-2">
            <InstagramIcon className="h-5 w-5 text-[oklch(0.75_0.15_270)]" />
            Models
          </h2>
          <p className="text-xs text-muted-foreground mt-1">
            Saved accounts — click to browse
          </p>
        </div>

        {/* Add / retag form */}
        {formOpen ? (
          <div className="glass-strong rounded-xl p-3 space-y-2.5">
            <p className="text-xs font-medium">
              {editing ? `Retag @${editing.username}` : "Add account"}
            </p>
            {!editing && (
              <Input
                value={newUsername}
                onChange={(e) => setNewUsername(e.target.value)}
                placeholder="@username"
                className="glass border-white/10 h-9"
                disabled={adding}
                autoFocus
              />
            )}
            <TagField
              label="Models"
              selected={newModels}
              onChange={setNewModels}
              options={options.models}
              placeholder="add a model…"
              disabled={adding}
            />
            <TagField
              label="Niches"
              selected={newNiches}
              onChange={setNewNiches}
              options={options.niches}
              placeholder="add a niche…"
              disabled={adding}
            />
            <div className="flex gap-2 pt-0.5">
              <Button
                size="sm"
                onClick={submitForm}
                disabled={adding || (!editing && !newUsername.trim())}
                className="h-8 flex-1 text-xs"
              >
                {adding ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : editing ? (
                  "Save"
                ) : (
                  "Add"
                )}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={closeForm}
                disabled={adding}
                className="h-8 text-xs"
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <Button
            size="sm"
            onClick={openAddForm}
            className="w-full h-9 text-xs justify-start gap-2"
          >
            <Plus className="h-4 w-4" /> Add account
          </Button>
        )}

        {/* Global library — every saved video, regardless of account */}
        <button
          onClick={() => openLibrary({ kind: "all" })}
          className={cn(
            "w-full flex items-center gap-3 rounded-xl px-3 py-2.5 transition-all text-left",
            mode === "library" && scope.kind === "all"
              ? "glass-strong bg-[oklch(0.75_0.15_270_/_12%)]"
              : "glass hover:bg-white/5"
          )}
        >
          <div className="h-9 w-9 rounded-lg bg-[oklch(0.75_0.15_270_/_15%)] flex items-center justify-center shrink-0">
            <BookmarkCheck className="h-4 w-4 text-[oklch(0.85_0.12_270)]" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">Saved videos</p>
            <p className="text-xs text-muted-foreground">
              {totalSaved} across all models
            </p>
          </div>
        </button>

        <div className="h-px bg-white/10" />

        {/* Group-by switch */}
        <div className="glass rounded-lg p-1 flex gap-1">
          {(["niche", "model"] as GroupBy[]).map((g) => (
            <button
              key={g}
              onClick={() => setGroupBy(g)}
              className={cn(
                "flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-md text-xs font-medium capitalize transition-colors",
                groupBy === g
                  ? "bg-[oklch(0.75_0.15_270_/_15%)] text-[oklch(0.85_0.12_270)]"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {g === "niche" ? (
                <Tag className="h-3 w-3" />
              ) : (
                <Users className="h-3 w-3" />
              )}
              {g}
            </button>
          ))}
        </div>

        {/* Accounts, bucketed by the active dimension */}
        <div className="space-y-2">
          {accounts.length === 0 && (
            <p className="text-xs text-muted-foreground glass rounded-xl p-4">
              No models yet. Add an Instagram account above to start building
              your list.
            </p>
          )}
          {groups.map(([groupName, members]) => {
            const isCollapsed = collapsed[`${groupBy}:${groupName}`];
            const scoped =
              mode === "library" &&
              scope.kind === groupBy &&
              scope.value === groupName;
            return (
              <div key={groupName} className="space-y-1.5">
                <div className="group/hdr w-full flex items-center gap-2 px-1 py-1">
                  <button
                    onClick={() =>
                      setCollapsed((c) => ({
                        ...c,
                        [`${groupBy}:${groupName}`]: !isCollapsed,
                      }))
                    }
                    className="flex items-center gap-2 min-w-0 flex-1 text-left"
                  >
                    <ChevronRight
                      className={cn(
                        "h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform",
                        !isCollapsed && "rotate-90"
                      )}
                    />
                    <span
                      className={cn(
                        "text-xs font-semibold uppercase tracking-wide truncate",
                        scoped
                          ? "text-white"
                          : groupName === UNASSIGNED
                            ? "text-muted-foreground/60"
                            : "text-[oklch(0.85_0.12_270)]"
                      )}
                    >
                      {groupName}
                    </span>
                  </button>

                  {/* Saved videos for just this model / niche */}
                  {groupName !== UNASSIGNED && (
                    <button
                      onClick={() =>
                        openLibrary({
                          kind: groupBy,
                          value: groupName,
                        } as Scope)
                      }
                      className={cn(
                        "shrink-0 transition-all",
                        scoped
                          ? "text-[oklch(0.85_0.12_270)]"
                          : "text-muted-foreground opacity-0 group-hover/hdr:opacity-100 hover:text-foreground"
                      )}
                      title={`Saved videos for ${groupName}`}
                    >
                      <BookmarkCheck className="h-3.5 w-3.5" />
                    </button>
                  )}

                  <Badge className="h-4 px-1.5 text-[10px] bg-white/10 shrink-0">
                    {members.length}
                  </Badge>
                </div>

                {!isCollapsed &&
                  members.map((a) => (
                    <div
                      key={a.id}
                      onClick={() => selectAccount(a)}
                      className={cn(
                        "group flex items-center gap-3 rounded-xl px-3 py-2.5 cursor-pointer transition-all ml-2",
                        selected?.id === a.id
                          ? "glass-strong bg-[oklch(0.75_0.15_270_/_12%)]"
                          : "glass hover:bg-white/5"
                      )}
                    >
                      {a.profilePicPath ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={fileUrl(a.profilePicPath)}
                          alt={a.username}
                          className="h-9 w-9 rounded-full object-cover border border-white/10"
                        />
                      ) : (
                        <div className="h-9 w-9 rounded-full bg-white/5 flex items-center justify-center">
                          <Users className="h-4 w-4 text-muted-foreground" />
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium truncate">
                          @{a.username}
                        </p>
                        <p className="text-xs text-muted-foreground truncate">
                          {/* The *other* dimension — the one not grouping */}
                          {(groupBy === "niche" ? a.models : a.niches)?.length
                            ? (groupBy === "niche" ? a.models : a.niches).join(", ")
                            : compact(a.followerCount) + " followers"}
                        </p>
                      </div>
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-all shrink-0">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            openEditForm(a);
                          }}
                          className="text-muted-foreground hover:text-foreground"
                          title="Edit model / niche"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            removeAccount(a);
                          }}
                          className="text-muted-foreground hover:text-red-400"
                          title="Remove"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
              </div>
            );
          })}
        </div>
      </aside>

      {/* ── Main: profile + grid ── */}
      <div className="flex-1 min-w-0 space-y-6">
        {mode === "library" ? (
          <>
            <div className="glass rounded-2xl p-5 flex items-center gap-4">
              <div className="h-14 w-14 rounded-xl bg-[oklch(0.75_0.15_270_/_15%)] flex items-center justify-center shrink-0">
                <BookmarkCheck className="h-7 w-7 text-[oklch(0.85_0.12_270)]" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <h2 className="text-2xl font-bold tracking-tight">
                    Saved videos
                  </h2>
                  {scope.kind !== "all" && (
                    <Badge className="bg-[oklch(0.75_0.15_270_/_25%)] border-white/20 text-white gap-1">
                      {scope.kind === "model" ? (
                        <Users className="h-3 w-3" />
                      ) : (
                        <Tag className="h-3 w-3" />
                      )}
                      {scope.value}
                      <button
                        onClick={() => openLibrary({ kind: "all" })}
                        className="ml-0.5 hover:text-white/70"
                        title="Show all saved videos"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </Badge>
                  )}
                </div>
                <p className="text-sm text-muted-foreground">
                  {scope.kind === "all"
                    ? `${library.length} saved across every model — hover to preview, or send any of them to Seedance / Motion Capture`
                    : `${library.length} saved for this ${scope.kind} — hover to preview, or send any of them to Seedance / Motion Capture`}
                </p>
              </div>
            </div>

            {loadingLibrary ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
                {Array.from({ length: 8 }).map((_, i) => (
                  <Skeleton key={i} className="aspect-[9/16] rounded-xl" />
                ))}
              </div>
            ) : library.length === 0 ? (
              <div className="glass rounded-2xl p-12 text-center text-sm text-muted-foreground">
                {scope.kind === "all"
                  ? "Nothing saved yet — pick a model on the left and bookmark the reels you want to keep."
                  : `No saved videos for this ${scope.kind} yet. Save reels from any account assigned to "${scope.value}" and they'll collect here.`}
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
                {library.map((item) => (
                  <ReelCard
                    key={item.id}
                    shortcode={item.shortcode}
                    localVideo={item.videoPath}
                    label={`@${usernameFor(item.accountId)}`}
                    thumbnail={item.thumbPath ? fileUrl(item.thumbPath) : null}
                    playCount={item.playCount}
                    likeCount={item.likeCount}
                    commentCount={item.commentCount}
                    takenAt={item.takenAt}
                    saved
                    downloaded={!!item.videoPath}
                    busy={busy[item.shortcode]}
                    onToggleSave={() => removeSaved(item)}
                    onRecreate={(target) => recreate(item, target)}
                    onAssign={() => openAssign(item)}
                  />
                ))}
              </div>
            )}
          </>
        ) : !selected ? (
          <div className="glass rounded-2xl p-16 text-center space-y-3">
            <InstagramIcon className="h-10 w-10 mx-auto text-muted-foreground" />
            <h3 className="text-lg font-semibold">Instagram browser</h3>
            <p className="text-sm text-muted-foreground max-w-md mx-auto">
              Pick a model on the left (or add one by username) to browse their
              reels, save the ones you like, and send any of them straight to
              Seedance or Motion Capture.
            </p>
          </div>
        ) : (
          <>
            {/* Profile header */}
            <div className="glass rounded-2xl p-5 flex items-center gap-5">
              {selected.profilePicPath ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={fileUrl(selected.profilePicPath)}
                  alt={selected.username}
                  className="h-20 w-20 rounded-full object-cover border-2 border-white/10"
                />
              ) : (
                <div className="h-20 w-20 rounded-full bg-white/5 flex items-center justify-center">
                  <Users className="h-8 w-8 text-muted-foreground" />
                </div>
              )}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-3">
                  <h2 className="text-2xl font-bold tracking-tight">
                    @{selected.username}
                  </h2>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => refreshAccount(selected)}
                    className="h-7 px-2 text-muted-foreground"
                    title="Refresh profile"
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                  </Button>
                </div>
                {selected.fullName && (
                  <p className="text-sm text-muted-foreground">{selected.fullName}</p>
                )}
                <div className="flex gap-4 mt-1.5 text-sm">
                  <span>
                    <strong>{compact(selected.mediaCount)}</strong>{" "}
                    <span className="text-muted-foreground">posts</span>
                  </span>
                  <span>
                    <strong>{compact(selected.followerCount)}</strong>{" "}
                    <span className="text-muted-foreground">followers</span>
                  </span>
                </div>
                {selected.biography && (
                  <p className="text-xs text-muted-foreground mt-1.5 line-clamp-2 max-w-xl">
                    {selected.biography}
                  </p>
                )}
              </div>
              {/* Tabs */}
              <div className="glass rounded-xl p-1 flex gap-1 shrink-0">
                <button
                  onClick={() => setTab("reels")}
                  className={cn(
                    "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors",
                    tab === "reels"
                      ? "bg-[oklch(0.75_0.15_270_/_15%)] text-[oklch(0.85_0.12_270)]"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  <Film className="h-3.5 w-3.5" /> Reels
                </button>
                <button
                  onClick={() => setTab("saved")}
                  className={cn(
                    "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors",
                    tab === "saved"
                      ? "bg-[oklch(0.75_0.15_270_/_15%)] text-[oklch(0.85_0.12_270)]"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  <BookmarkCheck className="h-3.5 w-3.5" /> Saved
                  {savedItems.length > 0 && (
                    <Badge className="ml-0.5 h-4 px-1.5 text-[10px] bg-white/10">
                      {savedItems.length}
                    </Badge>
                  )}
                </button>
              </div>
            </div>

            {/* Reels grid (live, most recent first) */}
            {tab === "reels" && (
              <>
                {loadingFeed ? (
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
                    {Array.from({ length: 8 }).map((_, i) => (
                      <Skeleton key={i} className="aspect-[9/16] rounded-xl" />
                    ))}
                  </div>
                ) : feed.length === 0 ? (
                  <div className="glass rounded-2xl p-12 text-center text-sm text-muted-foreground">
                    No reels found for this account.
                  </div>
                ) : (
                  <>
                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
                      {feed.map((item) => (
                        <ReelCard
                          key={item.shortcode}
                          shortcode={item.shortcode}
                          thumbnail={
                            item.thumbnailUrl ? proxied(item.thumbnailUrl) : null
                          }
                          playCount={item.playCount}
                          likeCount={item.likeCount}
                          commentCount={item.commentCount}
                          takenAt={item.takenAt}
                          saved={item.saved}
                          busy={busy[item.shortcode]}
                          onToggleSave={() => toggleSave(item)}
                          onRecreate={(target) => recreate(item, target)}
                          onAssign={() => openAssign(item)}
                        />
                      ))}
                    </div>
                    {nextMaxId && (
                      <div className="flex justify-center">
                        <Button
                          variant="outline"
                          onClick={loadMore}
                          disabled={loadingMore}
                          className="glass border-white/10"
                        >
                          {loadingMore && (
                            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                          )}
                          Load more
                        </Button>
                      </div>
                    )}
                  </>
                )}
              </>
            )}

            {/* Saved grid */}
            {tab === "saved" && (
              <>
                {savedItems.length === 0 ? (
                  <div className="glass rounded-2xl p-12 text-center text-sm text-muted-foreground">
                    Nothing saved yet — flip to Reels and bookmark the ones you
                    want to keep.
                  </div>
                ) : (
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
                    {savedItems.map((item) => (
                      <ReelCard
                        key={item.id}
                        shortcode={item.shortcode}
                        localVideo={item.videoPath}
                        thumbnail={item.thumbPath ? fileUrl(item.thumbPath) : null}
                        playCount={item.playCount}
                        likeCount={item.likeCount}
                        commentCount={item.commentCount}
                        takenAt={item.takenAt}
                        saved
                        downloaded={!!item.videoPath}
                        busy={busy[item.shortcode]}
                        onToggleSave={() => removeSaved(item)}
                        onRecreate={(target) => recreate(item, target)}
                    onAssign={() => openAssign(item)}
                      />
                    ))}
                  </div>
                )}
              </>
            )}
          </>
        )}
      </div>

      {/* Assign a clip to a work queue - Meta Ads or Instagram Reels. */}
      <Dialog
        open={assignFor !== null}
        onOpenChange={(open) => !open && setAssignFor(null)}
      >
        <DialogContent className="glass-strong border-white/10 sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Assign this clip</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div className="space-y-2">
              <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Queue
              </label>
              <div className="flex gap-2">
                {(Object.keys(QUEUE_LABEL) as Queue[]).map((q) => (
                  <button
                    key={q}
                    onClick={() => setAssignQueue(q)}
                    className={cn(
                      "flex-1 text-left p-2.5 rounded-xl text-xs font-medium transition-all",
                      assignQueue === q
                        ? "glass-strong border-[oklch(0.75_0.15_270_/_30%)]"
                        : "glass hover:bg-white/5 text-muted-foreground"
                    )}
                  >
                    {QUEUE_LABEL[q]}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Comment
              </label>
              <Textarea
                value={assignComment}
                onChange={(e) => setAssignComment(e.target.value)}
                rows={3}
                placeholder="What should be done with this clip?"
                className="glass border-white/10 resize-none text-sm"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Model
                </label>
                <select
                  value={assignModel}
                  onChange={(e) => setAssignModel(e.target.value)}
                  className="w-full glass border border-white/10 rounded-md h-9 px-2 text-sm bg-transparent"
                >
                  <option value="">- none -</option>
                  {options.models.map((m) => (
                    <option key={m} value={m} className="bg-neutral-900">
                      {m}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Format
                </label>
                <select
                  value={assignFormatId ?? ""}
                  onChange={(e) =>
                    setAssignFormatId(e.target.value ? Number(e.target.value) : null)
                  }
                  className="w-full glass border border-white/10 rounded-md h-9 px-2 text-sm bg-transparent"
                >
                  <option value="">- none -</option>
                  {formats.map((f) => (
                    <option key={f.id} value={f.id} className="bg-neutral-900">
                      {f.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button
                variant="outline"
                onClick={() => setAssignFor(null)}
                className="rounded-xl border-white/10"
              >
                Cancel
              </Button>
              <Button
                onClick={submitAssign}
                disabled={assigning}
                className="rounded-xl bg-[oklch(0.75_0.15_270)] hover:bg-[oklch(0.7_0.15_270)] text-white gap-2"
              >
                {assigning ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Megaphone className="h-4 w-4" />
                )}
                Assign
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Multi-select tag field ──
// Toggle any number of remembered options, or type a new one and press Enter.
// Selected values show as removable chips.
function TagField({
  label,
  selected,
  onChange,
  options,
  placeholder,
  disabled,
}: {
  label: string;
  selected: string[];
  onChange: (v: string[]) => void;
  options: string[];
  placeholder?: string;
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState("");

  const toggle = (value: string) => {
    onChange(
      selected.includes(value)
        ? selected.filter((v) => v !== value)
        : [...selected, value]
    );
  };

  const commitDraft = () => {
    const value = draft.trim();
    if (!value) return;
    if (!selected.includes(value)) onChange([...selected, value]);
    setDraft("");
  };

  // Remembered options not already picked — the "add another" shortlist.
  const unpicked = options.filter((o) => !selected.includes(o));

  return (
    <div className="space-y-1.5">
      <label className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </label>

      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {selected.map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => toggle(value)}
              disabled={disabled}
              className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] bg-[oklch(0.75_0.15_270_/_25%)] border border-white/20 text-white max-w-full"
              title="Remove"
            >
              <span className="truncate">{value}</span>
              <X className="h-2.5 w-2.5 shrink-0" />
            </button>
          ))}
        </div>
      )}

      <Input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commitDraft();
          }
        }}
        onBlur={commitDraft}
        placeholder={placeholder}
        className="glass border-white/10 h-8 text-xs"
        disabled={disabled}
      />

      {unpicked.length > 0 && (
        <div className="flex flex-wrap gap-1 max-h-24 overflow-y-auto">
          {unpicked.map((opt) => (
            <button
              key={opt}
              type="button"
              onClick={() => toggle(opt)}
              disabled={disabled}
              className="px-1.5 py-0.5 rounded text-[10px] border bg-white/5 border-white/10 text-muted-foreground hover:text-foreground transition-colors truncate max-w-full"
            >
              {opt}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// Resolved preview URLs, shared across cards for the page's lifetime so
// re-hovering (or re-rendering) never re-hits the API.
const previewUrlCache = new Map<string, string>();

// ── One reel card (shared between live + saved grids) ──
function ReelCard({
  shortcode,
  localVideo,
  label,
  thumbnail,
  playCount,
  likeCount,
  commentCount,
  takenAt,
  saved,
  downloaded,
  busy,
  onToggleSave,
  onRecreate,
  onAssign,
}: {
  shortcode: string;
  localVideo?: string | null; // already-downloaded file — plays instantly
  label?: string; // e.g. "@username" — shown in the mixed-account library
  thumbnail: string | null;
  playCount: number | null;
  likeCount: number | null;
  commentCount: number | null;
  takenAt: number | null;
  saved: boolean;
  downloaded?: boolean;
  busy?: string;
  onToggleSave: () => void;
  onRecreate: (target: "seedance" | "motion-capture") => void;
  onAssign: () => void;
}) {
  const [hovering, setHovering] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const startPreview = () => {
    setHovering(true);
    if (previewUrl) return;
    if (localVideo) {
      setPreviewUrl(fileUrl(localVideo));
      return;
    }
    const cached = previewUrlCache.get(shortcode);
    if (cached) {
      setPreviewUrl(cached);
      return;
    }
    // Small delay so skimming across the grid doesn't fire an API call per card.
    hoverTimer.current = setTimeout(async () => {
      setPreviewLoading(true);
      try {
        const res = await fetch(`/api/instagram/video?shortcode=${shortcode}`);
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        previewUrlCache.set(shortcode, data.url);
        setPreviewUrl(data.url);
      } catch {
        // no preview — thumbnail stays, not worth a toast
      } finally {
        setPreviewLoading(false);
      }
    }, 300);
  };

  const stopPreview = () => {
    setHovering(false);
    if (hoverTimer.current) {
      clearTimeout(hoverTimer.current);
      hoverTimer.current = null;
    }
  };

  return (
    <div
      className="group relative aspect-[9/16] rounded-xl overflow-hidden glass"
      onMouseEnter={startPreview}
      onMouseLeave={stopPreview}
    >
      {thumbnail ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={thumbnail}
          alt=""
          loading="lazy"
          className="absolute inset-0 h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
        />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center text-muted-foreground">
          <Film className="h-8 w-8" />
        </div>
      )}

      {/* Hover preview: muted looping video over the thumbnail */}
      {hovering && previewUrl && (
        <video
          src={previewUrl}
          autoPlay
          muted
          loop
          playsInline
          className="absolute inset-0 h-full w-full object-cover"
        />
      )}
      {hovering && previewLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/30">
          <Loader2 className="h-6 w-6 animate-spin text-white/80" />
        </div>
      )}

      {/* Top-left: owner / age; top-right: save toggle */}
      <div className="absolute top-2 left-2 right-2 flex items-start justify-between">
        {label ? (
          <Badge className="bg-black/60 backdrop-blur text-white/90 border-0 text-[10px] max-w-[70%] truncate">
            {label}
          </Badge>
        ) : takenAt ? (
          <Badge className="bg-black/50 backdrop-blur text-white/90 border-0 text-[10px]">
            {timeAgo(takenAt)}
          </Badge>
        ) : (
          <span />
        )}
        <button
          onClick={onToggleSave}
          disabled={!!busy}
          className={cn(
            "h-8 w-8 rounded-lg flex items-center justify-center backdrop-blur transition-colors",
            saved
              ? "bg-[oklch(0.75_0.15_270_/_35%)] text-white"
              : "bg-black/50 text-white/70 hover:text-white"
          )}
          title={saved ? "Remove from saved" : "Save"}
        >
          {busy === "saving" ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : saved ? (
            <BookmarkCheck className="h-4 w-4" />
          ) : (
            <Bookmark className="h-4 w-4" />
          )}
        </button>
      </div>

      {/* Bottom: stats + recreate */}
      <div className="absolute bottom-0 inset-x-0 p-2.5 bg-gradient-to-t from-black/80 via-black/40 to-transparent space-y-2">
        <div className="flex items-center gap-3 text-[11px] text-white/90">
          <span className="flex items-center gap-1">
            <Play className="h-3 w-3" /> {compact(playCount)}
          </span>
          <span className="flex items-center gap-1">
            <Heart className="h-3 w-3" /> {compact(likeCount)}
          </span>
          <span className="flex items-center gap-1">
            <MessageCircle className="h-3 w-3" /> {compact(commentCount)}
          </span>
          {downloaded && (
            <Download className="h-3 w-3 ml-auto text-emerald-400" />
          )}
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                size="sm"
                disabled={!!busy}
                className="w-full h-8 text-xs bg-[oklch(0.75_0.15_270_/_25%)] hover:bg-[oklch(0.75_0.15_270_/_40%)] text-white border border-white/10 opacity-0 group-hover:opacity-100 transition-opacity"
              />
            }
          >
            {busy === "downloading" ? (
              <>
                <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                Downloading…
              </>
            ) : (
              "Recreate"
            )}
          </DropdownMenuTrigger>
          <DropdownMenuContent className="glass-strong border-white/10">
            <DropdownMenuItem onClick={onAssign}>
              <Megaphone className="h-4 w-4 mr-2" />
              Assign to a queue
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onRecreate("seedance")}>
              <Shirt className="h-4 w-4 mr-2" /> Seedance
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onRecreate("motion-capture")}>
              <Clapperboard className="h-4 w-4 mr-2" /> Motion Capture
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
