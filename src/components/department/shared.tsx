"use client";

import Link from "next/link";
import { ChevronLeft, ChevronRight, Timer, Puzzle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { CLOCKED_ROLES } from "@/lib/roles";
import { addDays, prettyDate, secondsSince, todayLocal } from "@/lib/day";
import { useMe } from "@/components/layout/me-context";

export type Status = "pending" | "approved" | "rejected" | "todo" | "submitted";

// Insights' QC state tokens (--pass / --review), contrast-checked for the dark card.
const STATUS_STYLE: Record<Status, string> = {
  pending: "bg-[var(--review)]/15 text-[var(--review)]",
  submitted: "bg-chart-2/15 text-chart-2",
  approved: "bg-[var(--pass)]/15 text-[var(--pass)]",
  rejected: "bg-destructive/15 text-destructive",
  todo: "bg-secondary text-muted-foreground",
};

const STATUS_LABEL: Record<Status, string> = {
  pending: "Pending review",
  submitted: "Handed in",
  approved: "Approved",
  rejected: "Rejected",
  todo: "To do",
};

export function StatusBadge({ status }: { status: Status }) {
  return (
    <Badge className={cn("h-5 shrink-0 rounded-full border-0 px-2 text-[11px] font-medium", STATUS_STYLE[status])}>
      <span className="size-1.5 rounded-full bg-current" />
      {STATUS_LABEL[status]}
    </Badge>
  );
}

// Toggleable chips for picking several of a fixed list (models).
export function ChipPicker({
  options,
  value,
  onChange,
  empty = "No options yet",
}: {
  options: string[];
  value: string[];
  onChange: (next: string[]) => void;
  empty?: string;
}) {
  if (options.length === 0) {
    return <p className="text-xs text-muted-foreground">{empty}</p>;
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => {
        const on = value.includes(o);
        return (
          <button
            key={o}
            type="button"
            onClick={() => onChange(on ? value.filter((v) => v !== o) : [...value, o])}
            className={cn(
              "rounded-md border px-2.5 py-1 text-xs font-medium transition-colors",
              on
                ? "border-brand/60 bg-brand/15 text-brand"
                : "border-border bg-card text-muted-foreground hover:bg-accent hover:text-foreground"
            )}
          >
            {o}
          </button>
        );
      })}
    </div>
  );
}

// < Tue, Sep 23 > with a native date input for jumping further.
export function DayPicker({
  date,
  onChange,
}: {
  date: string;
  onChange: (d: string) => void;
}) {
  const isToday = date === todayLocal();
  return (
    <div className="flex items-center gap-1.5">
      <Button
        variant="outline"
        size="sm"
        className="h-8 w-8 p-0 rounded-lg"
        onClick={() => onChange(addDays(date, -1))}
        title="Previous day"
      >
        <ChevronLeft className="h-4 w-4" />
      </Button>
      <label className="relative flex h-8 cursor-pointer items-center rounded-lg border border-border bg-card px-3 text-sm font-medium hover:bg-accent">
        {prettyDate(date)}
        <input
          type="date"
          value={date}
          onChange={(e) => e.target.value && onChange(e.target.value)}
          className="absolute inset-0 opacity-0 cursor-pointer"
        />
      </label>
      <Button
        variant="outline"
        size="sm"
        className="h-8 w-8 p-0 rounded-lg"
        onClick={() => onChange(addDays(date, 1))}
        title="Next day"
      >
        <ChevronRight className="h-4 w-4" />
      </Button>
      {!isToday && (
        <Button
          variant="ghost"
          size="sm"
          className="h-8 text-xs"
          onClick={() => onChange(todayLocal())}
        >
          Today
        </Button>
      )}
    </div>
  );
}

// Nudges for tracked roles: clock in, and set up the Chrome tracker.
export function WorkBanners() {
  const { me, clock, setClock } = useMe();
  if (!me || !clock || !CLOCKED_ROLES.includes(me.role)) return null;
  const trackerStale =
    !clock.tracker.hasKey ||
    !clock.tracker.lastUsedAt ||
    secondsSince(clock.tracker.lastUsedAt) > 24 * 3600;

  return (
    <div className="space-y-2">
      {!clock.session && (
        <div className="flex items-center gap-3 rounded-xl border border-brand/30 bg-brand/[0.06] px-4 py-3">
          <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-brand/15 text-brand">
            <Timer className="size-4" />
          </span>
          <p className="flex-1 text-sm">
            {"You're not clocked in. Clock in to start submitting today's work."}
          </p>
          <Button size="sm" onClick={() => setClock("in")} className="bg-brand text-brand-foreground hover:bg-brand/90">
            Clock in
          </Button>
        </div>
      )}
      {trackerStale && (
        <div className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3">
          <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-secondary text-muted-foreground">
            <Puzzle className="size-4" />
          </span>
          <p className="text-sm flex-1 text-muted-foreground">
            {"The Chrome work tracker isn't connected on this account yet."}
          </p>
          <Link
            href="/tracker"
            className="rounded-md border border-border px-2.5 py-1 text-xs font-medium hover:bg-accent"
          >
            Set it up
          </Link>
        </div>
      )}
    </div>
  );
}

// "instagram.com/reel/ABC123": enough to recognise a link at a glance.
export function shortLink(url: string): string {
  try {
    const u = new URL(url);
    return `${u.hostname.replace(/^www\./, "")}${u.pathname.replace(/\/$/, "")}`;
  } catch {
    return url;
  }
}

// Insights' page header: orange eyebrow (the section), title, one-line subtitle.
export function PageHeader({ eyebrow, title, subtitle, children }: {
  eyebrow?: string;
  title: string;
  subtitle: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex items-end justify-between gap-4 flex-wrap">
      <div>
        {eyebrow && <p className="text-sm font-medium text-brand">{eyebrow}</p>}
        <h1 className={cn("text-2xl font-semibold tracking-tight", eyebrow && "mt-1")}>{title}</h1>
        <p className="text-sm text-muted-foreground mt-1">{subtitle}</p>
      </div>
      {children}
    </div>
  );
}
