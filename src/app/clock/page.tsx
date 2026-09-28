"use client";

import { useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  CoffeeIcon,
  PlayIcon,
  SignInIcon,
  SignOutIcon,
  SpinnerGapIcon,
  TimerIcon,
  WarningIcon,
} from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Kpi } from "@/components/dashboard/primitives";
import { PageHeader } from "@/components/department/shared";
import { useMe, type ClockAction, type Punch } from "@/components/layout/me-context";
import { clockTime, formatDuration } from "@/lib/day";
import { cn } from "@/lib/utils";

// A clock that ticks once a second without setState-in-effect: the browser's
// time is an external store, read through useSyncExternalStore.
function subscribe(cb: () => void) {
  const t = setInterval(cb, 1000);
  return () => clearInterval(t);
}
const nowSeconds = () => Math.floor(Date.now() / 1000);
const useNow = () => useSyncExternalStore(subscribe, nowSeconds, () => 0) * 1000;

const PUNCH: Record<ClockAction, { label: string; Icon: typeof TimerIcon; tone: string }> = {
  in: { label: "Clocked in", Icon: SignInIcon, tone: "text-[var(--pass)] bg-[var(--pass)]/12" },
  break_start: { label: "Break started", Icon: CoffeeIcon, tone: "text-[var(--review)] bg-[var(--review)]/12" },
  break_end: { label: "Back from break", Icon: PlayIcon, tone: "text-chart-2 bg-chart-2/12" },
  out: { label: "Clocked out", Icon: SignOutIcon, tone: "text-muted-foreground bg-secondary" },
};

const DONE: Record<ClockAction, string> = {
  in: "Clocked in",
  out: "Clocked out",
  break_start: "Break started",
  break_end: "Back to work",
};

export default function TimeClockPage() {
  const { me, clock, setClock } = useMe();
  const now = useNow();
  const [busy, setBusy] = useState<ClockAction | null>(null);

  const run = async (action: ClockAction) => {
    if (action === "out" && !confirm("Clock out for today?")) return;
    setBusy(action);
    try {
      await setClock(action);
      toast.success(DONE[action]);
    } catch {
      toast.error("That didn't go through. Try again.");
    } finally {
      setBusy(null);
    }
  };

  const session = clock?.session ?? null;
  const onBreak = !!session?.onBreak;
  const openBreak = session?.breaks.find((b) => !b.end);
  const since = (iso: string) => Math.max(0, (now - Date.parse(iso)) / 1000);
  // Server totals are as of `asOf`; the running one grows by the time since.
  const elapsed = clock && now ? since(clock.asOf) : 0;
  const worked = (clock?.todaySeconds ?? 0) + (session && !onBreak ? elapsed : 0);
  const breaks = (clock?.todayBreakSeconds ?? 0) + (onBreak ? elapsed : 0);
  const punches = clock?.punches ?? [];
  const firstIn = punches.find((p) => p.kind === "in");

  const state = !session ? "off" : onBreak ? "break" : "working";
  const spinner = <SpinnerGapIcon className="size-5 animate-spin" />;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Department"
        title="Time clock"
        subtitle="Clock in when you start, take breaks here, clock out when you're done. Breaks don't count as worked time."
      >
        <Link href="/hours" className="text-sm font-medium text-brand hover:underline">
          My hours →
        </Link>
      </PageHeader>

      <Card className="gap-0 overflow-hidden p-0">
        <div className="grid gap-6 p-6 md:grid-cols-[1fr_auto] md:items-center">
          <div className="space-y-3">
            <span
              className={cn(
                "inline-flex items-center gap-2 rounded-full px-3 py-1 text-sm font-medium",
                state === "working" && "bg-[var(--pass)]/12 text-[var(--pass)]",
                state === "break" && "bg-[var(--review)]/12 text-[var(--review)]",
                state === "off" && "bg-secondary text-muted-foreground"
              )}
            >
              <span className={cn("size-2 rounded-full bg-current", state !== "off" && "pulse-soft")} />
              {state === "working" ? "Working" : state === "break" ? "On break" : "Clocked out"}
            </span>
            <p className="tnum text-5xl font-semibold tracking-tight">
              {now ? new Date(now).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }) : "--:--"}
            </p>
            <p className="text-sm text-muted-foreground">
              {state === "working" && session && `Since ${clockTime(session.clockIn)}${me ? `, ${me.name}` : ""}`}
              {state === "break" && openBreak && `Break started at ${clockTime(openBreak.start)} · ${formatDuration(since(openBreak.start))} so far`}
              {state === "off" && "You're not on the clock."}
            </p>
          </div>

          <div className="flex flex-wrap gap-3 md:flex-col md:items-stretch">
            {!clock ? (
              <Skeleton className="h-12 w-48 rounded-xl" />
            ) : state === "off" ? (
              <Button
                size="lg"
                onClick={() => run("in")}
                disabled={!!busy}
                className="h-12 min-w-48 gap-2 bg-brand text-base text-brand-foreground hover:bg-brand/90"
              >
                {busy === "in" ? spinner : <SignInIcon weight="bold" className="size-5" />}
                Clock in
              </Button>
            ) : (
              <>
                {state === "working" ? (
                  <Button
                    size="lg"
                    onClick={() => run("break_start")}
                    disabled={!!busy}
                    className="h-12 min-w-48 gap-2 bg-[var(--review)]/15 text-base text-[var(--review)] hover:bg-[var(--review)]/25"
                  >
                    {busy === "break_start" ? spinner : <CoffeeIcon weight="bold" className="size-5" />}
                    Start break
                  </Button>
                ) : (
                  <Button
                    size="lg"
                    onClick={() => run("break_end")}
                    disabled={!!busy}
                    className="h-12 min-w-48 gap-2 bg-brand text-base text-brand-foreground hover:bg-brand/90"
                  >
                    {busy === "break_end" ? spinner : <PlayIcon weight="fill" className="size-5" />}
                    End break
                  </Button>
                )}
                <Button
                  size="lg"
                  variant="outline"
                  onClick={() => run("out")}
                  disabled={!!busy}
                  className="h-12 min-w-48 gap-2 text-base"
                >
                  {busy === "out" ? spinner : <SignOutIcon weight="bold" className="size-5" />}
                  Clock out
                </Button>
              </>
            )}
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Worked today" value={formatDuration(worked)} accent={state === "working"} />
        <Kpi label="Breaks today" value={formatDuration(breaks)} accent={state === "break"} />
        <Kpi label="First clock-in" value={firstIn ? clockTime(firstIn.at) : "–"} />
        <Kpi
          label="Breaks taken"
          value={String(punches.filter((p) => p.kind === "break_start").length)}
        />
      </div>

      <Card className="gap-0 p-0">
        <div className="border-b border-border px-5 py-4">
          <h2 className="text-base font-semibold">{"Today's log"}</h2>
          <p className="text-sm text-muted-foreground">Every clock-in, break and clock-out, in order.</p>
        </div>
        {!clock ? (
          <Skeleton className="m-5 h-24 rounded-xl" />
        ) : punches.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-muted-foreground">Nothing yet today.</p>
        ) : (
          <ol className="px-5 py-4">
            {punches.map((p, i) => (
              <PunchRow key={`${p.at}-${p.kind}`} punch={p} next={punches[i + 1]} last={i === punches.length - 1} now={now} />
            ))}
          </ol>
        )}
      </Card>
    </div>
  );
}

function PunchRow({ punch: p, next, last, now }: { punch: Punch; next?: Punch; last: boolean; now: number }) {
  const { label, Icon, tone } = PUNCH[p.kind];
  // What the stretch after this punch was: work, a break, or the end.
  const until = next ? Date.parse(next.at) : p.kind === "out" ? null : now || null;
  const stretch = until ? Math.max(0, (until - Date.parse(p.at)) / 1000) : null;
  const stretchLabel =
    p.kind === "break_start" ? "break" : p.kind === "in" || p.kind === "break_end" ? "worked" : null;

  return (
    <li className="relative flex gap-4 pb-5 last:pb-0">
      {!last && <span className="absolute left-[15px] top-8 bottom-0 w-px bg-border" />}
      <span className={cn("grid size-8 shrink-0 place-items-center rounded-full", tone)}>
        <Icon weight="bold" className="size-4" />
      </span>
      <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-3 pt-1">
        <span className="tnum w-14 text-sm font-semibold">{clockTime(p.at)}</span>
        <span className="text-sm">{label}</span>
        {p.auto && (
          <span className="inline-flex items-center gap-1 text-xs text-[var(--review)]">
            <WarningIcon weight="fill" className="size-3.5" /> automatic (forgot to clock out)
          </span>
        )}
        {stretch !== null && stretchLabel && (
          <span className="tnum ml-auto text-xs text-muted-foreground">
            {formatDuration(stretch)} {stretchLabel}
            {!next && " so far"}
          </span>
        )}
      </div>
    </li>
  );
}
