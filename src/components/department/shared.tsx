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

const STATUS_STYLE: Record<Status, string> = {
  pending: "bg-amber-500/15 text-amber-300",
  submitted: "bg-sky-500/15 text-sky-300",
  approved: "bg-emerald-500/15 text-emerald-300",
  rejected: "bg-red-500/15 text-red-300",
  todo: "bg-white/10 text-muted-foreground",
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
    <Badge className={cn("text-[10px] h-5 px-1.5 border-0", STATUS_STYLE[status])}>
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
              "px-2.5 py-1 rounded-lg text-xs border transition-colors",
              on
                ? "bg-brand/20 border-brand/50 text-brand"
                : "border-white/10 text-muted-foreground hover:text-foreground hover:bg-white/5"
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
        className="h-8 w-8 p-0 rounded-lg border-white/10"
        onClick={() => onChange(addDays(date, -1))}
        title="Previous day"
      >
        <ChevronLeft className="h-4 w-4" />
      </Button>
      <label className="relative glass rounded-lg h-8 px-3 flex items-center text-sm font-medium cursor-pointer">
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
        className="h-8 w-8 p-0 rounded-lg border-white/10"
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
        <div className="glass rounded-xl px-4 py-3 flex items-center gap-3 border border-amber-500/30">
          <Timer className="h-4 w-4 text-amber-300 shrink-0" />
          <p className="text-sm flex-1">
            {"You're not clocked in. Clock in to start submitting today's work."}
          </p>
          <Button
            size="sm"
            onClick={() => setClock("in")}
            className="rounded-lg bg-amber-500/80 hover:bg-amber-500 text-black"
          >
            Clock in
          </Button>
        </div>
      )}
      {trackerStale && (
        <div className="glass rounded-xl px-4 py-3 flex items-center gap-3 border border-white/10">
          <Puzzle className="h-4 w-4 text-muted-foreground shrink-0" />
          <p className="text-sm flex-1 text-muted-foreground">
            {"The Chrome work tracker isn't connected on this account yet."}
          </p>
          <Link href="/tracker" className="text-xs underline underline-offset-2">
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

export function PageHeader({ title, subtitle, children }: {
  title: string;
  subtitle: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex items-end justify-between gap-4 flex-wrap">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight">
          {title}
        </h2>
        <p className="text-sm text-muted-foreground mt-1">{subtitle}</p>
      </div>
      {children}
    </div>
  );
}
