"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CoffeeIcon, PlayIcon, SpinnerGapIcon, TimerIcon } from "@phosphor-icons/react";
import { toast } from "sonner";
import { useMe, type ClockAction } from "@/components/layout/me-context";
import { formatDuration, secondsSince } from "@/lib/day";
import { cn } from "@/lib/utils";

const DONE: Record<ClockAction, string> = {
  in: "Clocked in",
  out: "Clocked out",
  break_start: "Break started",
  break_end: "Back to work",
};

// The clock in the top bar: clock in, take / end a break, and today's
// running total. The total links to the Time clock page (clock out lives there).
export function ClockButton() {
  const { clock, setClock } = useMe();
  const [busy, setBusy] = useState<ClockAction | null>(null);
  const [, tick] = useState(0);

  // Re-render every 30s so the running totals tick without a fetch.
  useEffect(() => {
    if (!clock?.session) return;
    const t = setInterval(() => tick((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, [clock?.session]);

  const run = async (action: ClockAction) => {
    setBusy(action);
    try {
      await setClock(action);
      toast.success(DONE[action]);
    } catch {
      toast.error("Clock failed");
    } finally {
      setBusy(null);
    }
  };

  const session = clock?.session ?? null;
  const onBreak = !!session?.onBreak;
  const openBreak = session?.breaks.find((b) => !b.end);
  // Server totals are as of `asOf`; add what's elapsed since.
  const worked = (clock?.todaySeconds ?? 0) + (session && !onBreak && clock ? secondsSince(clock.asOf) : 0);
  const spinner = <SpinnerGapIcon className="size-4 animate-spin" />;

  if (!session) {
    return (
      <button
        type="button"
        onClick={() => run("in")}
        disabled={!!busy || !clock}
        title="Clock in to start your day"
        className="flex h-8 items-center gap-1.5 rounded-full border border-brand/40 bg-brand/10 px-3 text-sm font-medium text-brand transition-colors hover:bg-brand/15 disabled:opacity-60"
      >
        {busy ? spinner : <TimerIcon className="size-4" />}
        Clock in
      </button>
    );
  }

  return (
    <div
      className={cn(
        "flex h-8 items-center rounded-full border text-sm font-medium",
        onBreak
          ? "border-[var(--review)]/40 bg-[var(--review)]/10 text-[var(--review)]"
          : "border-[var(--pass)]/40 bg-[var(--pass)]/10 text-[var(--pass)]"
      )}
    >
      <Link
        href="/clock"
        title="Time clock"
        className="flex h-full items-center gap-1.5 rounded-l-full pl-3 pr-2 hover:bg-white/5"
      >
        {onBreak ? <CoffeeIcon weight="fill" className="size-4" /> : <TimerIcon weight="fill" className="size-4" />}
        {onBreak ? (
          <span className="tnum">
            <span className="hidden md:inline">On break · </span>
            {formatDuration(openBreak ? secondsSince(openBreak.start) : 0)}
          </span>
        ) : (
          <span className="tnum">{formatDuration(worked)}</span>
        )}
      </Link>
      <span className="h-4 w-px bg-current opacity-25" />
      <button
        type="button"
        onClick={() => run(onBreak ? "break_end" : "break_start")}
        disabled={!!busy}
        title={onBreak ? "End break" : "Take a break"}
        className="flex h-full items-center gap-1 rounded-r-full pl-2 pr-3 hover:bg-white/5 disabled:opacity-60"
      >
        {busy ? spinner : onBreak ? <PlayIcon weight="fill" className="size-3.5" /> : <CoffeeIcon className="size-4" />}
        <span className="hidden md:inline">{onBreak ? "Resume" : "Break"}</span>
      </button>
    </div>
  );
}
