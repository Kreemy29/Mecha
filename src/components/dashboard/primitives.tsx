"use client";

// Copied from OneUp Insights (components/dashboard/primitives.tsx): the KPI
// tile and chart card. Insights' analytics-specific pieces are left out.
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { TrendUpIcon, TrendDownIcon } from "@phosphor-icons/react";

/** KPI stat card with an optional delta indicator. */
export function Kpi({
  label,
  value,
  sub,
  deltaPct,
  accent,
}: {
  label: string;
  value: string;
  sub?: string;
  /** change vs previous period; renders green/red arrow */
  deltaPct?: number | null;
  accent?: boolean;
}) {
  const showDelta = typeof deltaPct === "number" && Math.abs(deltaPct) >= 1;
  return (
    <Card className="gap-0 p-4">
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="mt-2 flex items-baseline gap-2">
        <span className={cn("tnum text-2xl font-semibold tracking-tight", accent && "text-brand")}>
          {value}
        </span>
        {sub ? <span className="text-xs text-muted-foreground">{sub}</span> : null}
        {showDelta ? (
          <span
            className={cn(
              "tnum ml-auto flex items-center gap-0.5 text-xs font-semibold",
              deltaPct! > 0 ? "text-emerald-500" : "text-red-400",
            )}
          >
            {deltaPct! > 0 ? <TrendUpIcon weight="bold" className="size-3.5" /> : <TrendDownIcon weight="bold" className="size-3.5" />}
            {deltaPct! > 0 ? "+" : ""}
            {deltaPct!.toFixed(0)}%
          </span>
        ) : null}
      </div>
    </Card>
  );
}

/** Card wrapper for a chart with title + description. */
export function ChartCard({
  title,
  description,
  actions,
  children,
  className,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Card className={cn("gap-0 p-5", className)}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">{title}</h2>
          {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
        </div>
        {actions}
      </div>
      <div className="mt-4">{children}</div>
    </Card>
  );
}
