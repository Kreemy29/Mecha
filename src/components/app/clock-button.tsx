"use client";

import { useEffect, useState } from "react";
import { TimerIcon, SpinnerGapIcon } from "@phosphor-icons/react";
import { toast } from "sonner";
import { useMe } from "@/components/layout/me-context";
import { formatDuration, secondsSince } from "@/lib/day";
import { cn } from "@/lib/utils";

// Clock in / out, in the top bar. On the clock it shows today's running total.
export function ClockButton() {
  const { clock, setClock } = useMe();
  const [busy, setBusy] = useState(false);
  const [, tick] = useState(0);

  // Re-render every 30s so the running total ticks without a fetch.
  useEffect(() => {
    if (!clock?.session) return;
    const t = setInterval(() => tick((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, [clock?.session]);

  const on = !!clock?.session;
  // Server total is as of the last heartbeat; add what's elapsed since.
  const liveSeconds = (clock?.todaySeconds ?? 0) + (on ? secondsSince(clock!.session!.lastSeen) : 0);

  const toggle = async () => {
    setBusy(true);
    try {
      const next = on ? "out" : "in";
      await setClock(next);
      toast.success(next === "in" ? "Clocked in" : "Clocked out");
    } catch {
      toast.error("Clock failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={busy || !clock}
      title={on ? "Clock out" : "Clock in to start your day"}
      className={cn(
        "flex h-8 items-center gap-1.5 rounded-full border px-3 text-sm font-medium transition-colors disabled:opacity-60",
        on
          ? "border-[var(--pass)]/40 bg-[var(--pass)]/10 text-[var(--pass)] hover:bg-[var(--pass)]/15"
          : "border-brand/40 bg-brand/10 text-brand hover:bg-brand/15"
      )}
    >
      {busy ? (
        <SpinnerGapIcon className="size-4 animate-spin" />
      ) : (
        <TimerIcon weight={on ? "fill" : "regular"} className="size-4" />
      )}
      {on ? (
        <>
          <span className="tnum">{formatDuration(liveSeconds)}</span>
          <span className="hidden opacity-70 md:inline">· Clock out</span>
        </>
      ) : (
        "Clock in"
      )}
    </button>
  );
}
