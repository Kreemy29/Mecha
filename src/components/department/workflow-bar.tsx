"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { CheckCircleIcon, PaperPlaneTiltIcon, SpinnerGapIcon } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { useMe } from "@/components/layout/me-context";
import { can } from "@/lib/roles";
import { clockTime } from "@/lib/day";

interface Mark {
  userId: number;
  name: string;
  kind: "research_done" | "review_done";
  at: string;
}

export interface NotifyResult {
  recipients: number;
  telegram: number;
  email: number;
  unreachable: string[];
}

// Toast what happened to a notification: who got it, and who couldn't be reached.
export function reportNotified(what: string, r: NotifyResult | undefined) {
  if (!r) return toast.success(what);
  const reached = r.recipients - r.unreachable.length;
  const how = [r.telegram ? "Telegram" : null, r.email ? "email" : null].filter(Boolean).join(" + ");
  toast.success(`${what}. ${reached} of ${r.recipients} notified${how ? ` by ${how}` : ""}.`);
  if (r.unreachable.length) {
    toast.warning(
      `Couldn't reach ${r.unreachable.join(", ")}: no Telegram connected and no work email (Settings → Accounts / My profile).`
    );
  }
}

// The hand-off buttons for one day on Trends:
//   researcher → "Finished for today"  (tells the managers and the CEO)
//   CEO        → "Done reviewing"      (tells the managers what's approved)
export function TrendsWorkflowBar({ date, myCount }: { date: string; myCount: number }) {
  const { me } = useMe();
  const [marks, setMarks] = useState<Mark[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/workflow?date=${date}`);
    const d = await res.json();
    setMarks(Array.isArray(d.marks) ? d.marks : []);
  }, [date]);

  useEffect(() => {
    (async () => {
      await load();
    })();
  }, [load]);

  if (!me) return null;
  // The CEO (or any reviewer who isn't the manager) reports back; the manager
  // reviewing doesn't need to notify themselves.
  const showResearch = can.suggestTrends(me) && !can.manageProduction(me);
  const showReview = can.reviewTrends(me) && !can.manageProduction(me);

  const run = async (action: "research_done" | "review_done") => {
    if (action === "research_done" && myCount === 0) {
      toast.error("Add at least one reel or carousel for this day first.");
      return;
    }
    setBusy(action);
    try {
      const res = await fetch("/api/workflow", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, date }),
      });
      const d = await res.json();
      if (d.error) throw new Error(d.error);
      reportNotified(action === "research_done" ? "Sent for review" : "Review sent to the manager", d.notified);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "That didn't go through");
    } finally {
      setBusy(null);
    }
  };

  const mine = (kind: Mark["kind"]) => marks.find((m) => m.kind === kind && m.userId === me.id);
  const research = marks.filter((m) => m.kind === "research_done");
  const reviews = marks.filter((m) => m.kind === "review_done");

  if (!showResearch && !showReview && marks.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card px-4 py-3">
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-4 gap-y-1 text-sm">
        {research.length === 0 && reviews.length === 0 ? (
          <span className="text-muted-foreground">Nobody has marked this day done yet.</span>
        ) : (
          <>
            {research.map((m) => (
              <span key={`r${m.userId}`} className="inline-flex items-center gap-1.5">
                <CheckCircleIcon weight="fill" className="size-4 text-[var(--pass)]" />
                {m.name} finished research · {clockTime(m.at)}
              </span>
            ))}
            {reviews.map((m) => (
              <span key={`v${m.userId}`} className="inline-flex items-center gap-1.5">
                <CheckCircleIcon weight="fill" className="size-4 text-chart-2" />
                {m.name} reviewed · {clockTime(m.at)}
              </span>
            ))}
          </>
        )}
      </div>
      {showResearch && (
        <Button
          onClick={() => run("research_done")}
          disabled={!!busy}
          className="gap-1.5 bg-brand text-brand-foreground hover:bg-brand/90"
        >
          {busy === "research_done" ? <SpinnerGapIcon className="size-4 animate-spin" /> : <PaperPlaneTiltIcon className="size-4" />}
          {mine("research_done") ? "Send again" : "Finished for today"}
        </Button>
      )}
      {showReview && (
        <Button
          onClick={() => run("review_done")}
          disabled={!!busy}
          className="gap-1.5 bg-brand text-brand-foreground hover:bg-brand/90"
        >
          {busy === "review_done" ? <SpinnerGapIcon className="size-4 animate-spin" /> : <PaperPlaneTiltIcon className="size-4" />}
          {mine("review_done") ? "Send review again" : "Done reviewing"}
        </Button>
      )}
    </div>
  );
}
