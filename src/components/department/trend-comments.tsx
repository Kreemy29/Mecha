"use client";

import { useState } from "react";
import { toast } from "sonner";
import { ChatCircleTextIcon, PaperPlaneTiltIcon, SpinnerGapIcon, XIcon } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { can } from "@/lib/roles";
import { useMe } from "@/components/layout/me-context";

export interface TrendComment {
  id: number;
  trendId: number;
  authorId: number;
  author: string;
  body: string;
  createdAt: string;
}

const when = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

// The thread under an approved trend: the reviewer's approval note first,
// then replies from the researcher, manager and creators. The parent owns the
// list (it arrives on the trend) and gets the new one through onChange.
export function TrendComments({
  trendId,
  comments,
  onChange,
  className,
}: {
  trendId: number;
  comments: TrendComment[];
  onChange: (comments: TrendComment[]) => void;
  className?: string;
}) {
  const { me } = useMe();
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);

  const post = async () => {
    const body = draft.trim();
    if (!body || busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/trends/comments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trendId, body }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      onChange([...comments, data]);
      setDraft("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't post the comment");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (c: TrendComment) => {
    if (!confirm("Delete this comment?")) return;
    const res = await fetch(`/api/trends/comments?id=${c.id}`, { method: "DELETE" });
    const data = await res.json();
    if (data.error) return toast.error(data.error);
    onChange(comments.filter((x) => x.id !== c.id));
  };

  return (
    <div className={cn("space-y-2 rounded-lg border border-border bg-secondary/30 px-3 py-2.5", className)}>
      <p className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        <ChatCircleTextIcon className="size-3.5" /> Comments{comments.length > 0 && ` · ${comments.length}`}
      </p>

      {comments.length > 0 && (
        <ul className="space-y-2">
          {comments.map((c) => (
            <li key={c.id} className="group text-sm">
              <div className="flex items-baseline gap-2">
                <span className="text-xs font-semibold">{c.author}</span>
                <span className="text-[11px] text-muted-foreground">{when(c.createdAt)}</span>
                {me && (c.authorId === me.id || can.manageProduction(me)) && (
                  <button
                    type="button"
                    onClick={() => remove(c)}
                    title="Delete comment"
                    className="ml-auto text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
                  >
                    <XIcon className="size-3.5" />
                  </button>
                )}
              </div>
              <p className="whitespace-pre-wrap break-words text-sm">{c.body}</p>
            </li>
          ))}
        </ul>
      )}

      <form
        className="flex items-center gap-1.5"
        onSubmit={(e) => {
          e.preventDefault();
          post();
        }}
      >
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={comments.length ? "Reply…" : "Add a comment…"}
          maxLength={2000}
          className="h-8 text-sm"
        />
        <Button type="submit" size="icon-sm" variant="ghost" disabled={!draft.trim() || busy} title="Post comment">
          {busy ? <SpinnerGapIcon className="size-4 animate-spin" /> : <PaperPlaneTiltIcon className="size-4" />}
        </Button>
      </form>
    </div>
  );
}
