"use client";

import { useEffect, useState } from "react";
import { TimerIcon, WarningIcon } from "@phosphor-icons/react";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Kpi, ChartCard } from "@/components/dashboard/primitives";
import { PageHeader } from "@/components/department/shared";
import { RangePicker, rangeFor, RANGE_LABEL, type RangeKey } from "@/components/department/range";
import { useMe } from "@/components/layout/me-context";
import {
  clockTime,
  daysBetween,
  formatDuration,
  parseLocalDate,
  prettyDate,
  rangeBounds,
  secondsByDay,
  sessionSecondsWithin,
  startOfMonth,
  startOfWeek,
  toLocalDate,
  todayLocal,
} from "@/lib/day";
import { cn } from "@/lib/utils";

interface Session {
  id: number;
  clockIn: string;
  clockOut: string | null;
  lastSeen: string;
  autoClosed: boolean;
}

// Your own timesheet: today / week / month totals, hours per day for the
// picked range, and every clock-in session behind them.
export default function HoursPage() {
  const { clock } = useMe();
  const [range, setRange] = useState<RangeKey>("this_week");
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);

  const today = todayLocal();
  const picked = rangeFor(range, today);
  // One fetch covers the picked range AND the week/month-to-date tiles.
  const earliest = (a: string, b: string) => (a < b ? a : b);
  const spanFrom = earliest(picked.from, earliest(startOfWeek(today), startOfMonth(today)));
  const spanTo = picked.to > today ? picked.to : today;

  // Refetch when the range or the clock changes (in/out, heartbeat) so today
  // stays current. A reply for a range you've already left is dropped.
  const clockKey = `${clock?.session?.id ?? "off"}:${clock?.session?.lastSeen ?? ""}`;
  useEffect(() => {
    let stale = false;
    (async () => {
      const { from, to } = rangeBounds(spanFrom, spanTo);
      const res = await fetch(`/api/timesheet?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
      const data = await res.json();
      if (stale) return;
      setSessions(Array.isArray(data.sessions) ? data.sessions : []);
      setLoading(false);
    })();
    return () => {
      stale = true;
    };
  }, [spanFrom, spanTo, clockKey]);

  const perDay = secondsByDay(sessions, daysBetween(spanFrom, spanTo));
  const sum = (from: string, to: string) =>
    daysBetween(from, to).reduce((s, d) => s + (perDay[d] ?? 0), 0);

  const rangeDays = daysBetween(picked.from, picked.to);
  const rangeTotal = sum(picked.from, picked.to);
  const worked = rangeDays.filter((d) => (perDay[d] ?? 0) > 0).length;
  const max = Math.max(1, ...rangeDays.map((d) => perDay[d] ?? 0));

  const { from: pFrom, to: pTo } = rangeBounds(picked.from, picked.to);
  const listed = sessions
    .filter((s) => sessionSecondsWithin(s, pFrom, pTo) > 0)
    .sort((a, b) => b.clockIn.localeCompare(a.clockIn));

  return (
    <div className="space-y-6">
      <PageHeader title="My hours" subtitle="Everything you've clocked, from the button in the top bar.">
        <RangePicker value={range} onChange={setRange} />
      </PageHeader>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Today" value={formatDuration(perDay[today] ?? 0)} sub={clock?.session ? "on the clock" : undefined} accent={!!clock?.session} />
        <Kpi label="This week" value={formatDuration(sum(startOfWeek(today), today))} />
        <Kpi label="This month" value={formatDuration(sum(startOfMonth(today), today))} />
        <Kpi
          label={`${RANGE_LABEL[range]} · avg per day worked`}
          value={worked ? formatDuration(Math.round(rangeTotal / worked)) : "–"}
          sub={`${worked} day${worked === 1 ? "" : "s"}`}
        />
      </div>

      <ChartCard
        title={`Hours per day · ${RANGE_LABEL[range].toLowerCase()}`}
        description={`${formatDuration(rangeTotal)} in total, ${prettyDate(picked.from)} to ${prettyDate(picked.to)}`}
      >
        {loading ? (
          <Skeleton className="h-48 rounded-xl" />
        ) : (
          <DayBars days={rangeDays} perDay={perDay} max={max} today={today} />
        )}
      </ChartCard>

      <Card className="gap-0 p-0">
        <div className="px-5 py-4">
          <h2 className="text-base font-semibold">Sessions</h2>
          <p className="text-sm text-muted-foreground">Each clock-in to clock-out.</p>
        </div>
        {loading ? (
          <Skeleton className="m-5 h-24 rounded-xl" />
        ) : listed.length === 0 ? (
          <p className="px-5 pb-6 text-sm text-muted-foreground">No sessions in this range.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-y border-border text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-5 py-2.5 text-left font-medium">Day</th>
                <th className="px-3 py-2.5 text-left font-medium">Clock in</th>
                <th className="px-3 py-2.5 text-left font-medium">Clock out</th>
                <th className="px-5 py-2.5 text-right font-medium">Duration</th>
              </tr>
            </thead>
            <tbody>
              {listed.map((s) => {
                const open = !s.clockOut;
                return (
                  <tr key={s.id} className="border-b border-border last:border-0">
                    <td className="px-5 py-2.5">{prettyDate(toLocalDate(new Date(s.clockIn)))}</td>
                    <td className="tnum px-3 py-2.5">{clockTime(s.clockIn)}</td>
                    <td className="tnum px-3 py-2.5">
                      {open ? (
                        <span className="inline-flex items-center gap-1.5 text-[var(--pass)]">
                          <TimerIcon weight="fill" className="size-3.5" /> on the clock
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5">
                          {clockTime(s.clockOut!)}
                          {s.autoClosed && (
                            <span
                              title="You didn't clock out, so it was closed at your last activity"
                              className="inline-flex items-center gap-1 text-xs text-[var(--review)]"
                            >
                              <WarningIcon weight="fill" className="size-3.5" /> auto
                            </span>
                          )}
                        </span>
                      )}
                    </td>
                    <td className="tnum px-5 py-2.5 text-right font-medium">
                      {formatDuration(sessionSecondsWithin(s, s.clockIn, s.clockOut ?? s.lastSeen))}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}

// Plain CSS bars, one per day. Weekends are dimmed; today is orange.
function DayBars({
  days,
  perDay,
  max,
  today,
}: {
  days: string[];
  perDay: Record<string, number>;
  max: number;
  today: string;
}) {
  const dense = days.length > 10;
  return (
    <div className="flex h-48 items-end gap-1">
      {days.map((d) => {
        const s = perDay[d] ?? 0;
        const date = parseLocalDate(d);
        const weekend = date.getDay() === 0 || date.getDay() === 6;
        return (
          <div key={d} className="flex h-full min-w-0 flex-1 flex-col items-center gap-1.5" title={`${prettyDate(d)}: ${formatDuration(s)}`}>
            <div className="flex w-full flex-1 flex-col items-center justify-end gap-1">
              {!dense && s > 0 && <span className="tnum text-[11px] text-muted-foreground">{formatDuration(s)}</span>}
              <div
                className={cn(
                  "w-full max-w-10 rounded-t-md transition-all",
                  d === today ? "bg-brand" : s > 0 ? "bg-chart-2/70" : "bg-secondary",
                  weekend && d !== today && "opacity-60"
                )}
                style={{ height: s > 0 ? `${Math.max(4, (s / max) * 85)}%` : "3px" }}
              />
            </div>
            <span className={cn("text-[10px]", d === today ? "font-semibold text-brand" : "text-muted-foreground")}>
              {dense ? date.getDate() : date.toLocaleDateString(undefined, { weekday: "short" })}
            </span>
          </div>
        );
      })}
    </div>
  );
}
