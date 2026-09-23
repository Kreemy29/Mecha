"use client";

import { addDays, endOfMonth, startOfMonth, startOfWeek, todayLocal } from "@/lib/day";
import { cn } from "@/lib/utils";

export type RangeKey = "this_week" | "last_week" | "this_month" | "last_month";

export const RANGE_LABEL: Record<RangeKey, string> = {
  this_week: "This week",
  last_week: "Last week",
  this_month: "This month",
  last_month: "Last month",
};

// Local dates, inclusive. Weeks run Monday to Sunday.
export function rangeFor(key: RangeKey, today = todayLocal()): { from: string; to: string } {
  switch (key) {
    case "this_week": {
      const from = startOfWeek(today);
      return { from, to: addDays(from, 6) };
    }
    case "last_week": {
      const from = addDays(startOfWeek(today), -7);
      return { from, to: addDays(from, 6) };
    }
    case "this_month":
      return { from: startOfMonth(today), to: endOfMonth(today) };
    case "last_month": {
      const prev = addDays(startOfMonth(today), -1);
      return { from: startOfMonth(prev), to: endOfMonth(prev) };
    }
  }
}

export function RangePicker({ value, onChange }: { value: RangeKey; onChange: (k: RangeKey) => void }) {
  return (
    <div className="inline-flex rounded-lg border border-border bg-card p-0.5">
      {(Object.keys(RANGE_LABEL) as RangeKey[]).map((k) => (
        <button
          key={k}
          type="button"
          onClick={() => onChange(k)}
          className={cn(
            "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
            value === k ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground"
          )}
        >
          {RANGE_LABEL[k]}
        </button>
      ))}
    </div>
  );
}
