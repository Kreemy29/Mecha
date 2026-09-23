"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { DownloadSimpleIcon, ShieldCheckIcon, WarningIcon } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Kpi } from "@/components/dashboard/primitives";
import { PageHeader } from "@/components/department/shared";
import { RangePicker, rangeFor, RANGE_LABEL, type RangeKey } from "@/components/department/range";
import { useMe } from "@/components/layout/me-context";
import { can, CLOCKED_ROLES, ROLE_LABEL, type Role } from "@/lib/roles";
import {
  daysBetween,
  formatDuration,
  parseLocalDate,
  rangeBounds,
  secondsByDay,
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

interface Person {
  id: number;
  name: string;
  role: Role;
  clockedIn: boolean;
  sessions: Session[];
}

const hoursDecimal = (s: number) => (s / 3600).toFixed(2);

// Everyone's hours, per person per day, for a week or a month.
export default function TimesheetsPage() {
  const { me, loaded } = useMe();
  const [range, setRange] = useState<RangeKey>("this_week");
  const [people, setPeople] = useState<Person[]>([]);
  const [loading, setLoading] = useState(true);
  const [everyone, setEveryone] = useState(false);

  const today = todayLocal();
  const picked = rangeFor(range, today);
  const days = useMemo(() => daysBetween(picked.from, picked.to), [picked.from, picked.to]);

  const load = useCallback(async () => {
    const { from, to } = rangeBounds(picked.from, picked.to);
    const res = await fetch(
      `/api/timesheet?all=1&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`
    );
    const data = await res.json();
    setPeople(Array.isArray(data) ? data : []);
    setLoading(false);
  }, [picked.from, picked.to]);

  useEffect(() => {
    (async () => {
      await load();
    })();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, [load]);

  const rows = useMemo(
    () =>
      people
        .map((p) => {
          const perDay = secondsByDay(p.sessions, days);
          const total = days.reduce((s, d) => s + perDay[d], 0);
          const worked = days.filter((d) => perDay[d] > 0).length;
          const autoDays = new Set(
            p.sessions.filter((s) => s.autoClosed).map((s) => toLocalDate(new Date(s.clockIn)))
          );
          return { ...p, perDay, total, worked, autoDays };
        })
        // Tracked roles always show (a zero is information); others only if they clocked.
        .filter((r) => everyone || r.total > 0 || CLOCKED_ROLES.includes(r.role))
        .sort((a, b) => b.total - a.total),
    [people, days, everyone]
  );

  if (loaded && me && !can.viewTeam(me)) {
    return (
      <Card className="items-center gap-2 py-16 text-center">
        <ShieldCheckIcon className="size-6 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">Only managers and the CEO can see timesheets.</p>
      </Card>
    );
  }

  const teamTotal = rows.reduce((s, r) => s + r.total, 0);
  const onClock = people.filter((p) => p.clockedIn).length;
  const dense = days.length > 10;

  const exportCsv = () => {
    const header = ["Name", "Role", ...days, "Total hours"];
    const lines = rows.map((r) => [
      r.name,
      ROLE_LABEL[r.role] ?? r.role,
      ...days.map((d) => hoursDecimal(r.perDay[d])),
      hoursDecimal(r.total),
    ]);
    const csv = [header, ...lines]
      .map((cols) => cols.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `timesheet-${picked.from}-to-${picked.to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      <PageHeader title="Timesheets" subtitle="Hours clocked by everyone, per day. Open a day on the Team page for what they worked on.">
        <div className="flex flex-wrap items-center gap-2">
          <RangePicker value={range} onChange={setRange} />
          <Button variant="outline" onClick={exportCsv} disabled={rows.length === 0} className="gap-1.5">
            <DownloadSimpleIcon className="size-4" /> Export CSV
          </Button>
        </div>
      </PageHeader>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label={`Team total · ${RANGE_LABEL[range].toLowerCase()}`} value={formatDuration(teamTotal)} />
        <Kpi label="On the clock now" value={String(onClock)} accent={onClock > 0} />
        <Kpi label="People who clocked" value={String(rows.filter((r) => r.total > 0).length)} />
        <Kpi
          label="Avg per person"
          value={rows.length ? formatDuration(Math.round(teamTotal / Math.max(1, rows.filter((r) => r.total > 0).length))) : "–"}
        />
      </div>

      <Card className="gap-0 overflow-x-auto p-0">
        {loading ? (
          <Skeleton className="m-5 h-40 rounded-xl" />
        ) : rows.length === 0 ? (
          <p className="p-6 text-sm text-muted-foreground">Nobody clocked in during this range.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-xs text-muted-foreground">
                <th className="sticky left-0 z-10 bg-card px-5 py-2.5 text-left font-medium uppercase tracking-wide">
                  Person
                </th>
                {days.map((d) => {
                  const date = parseLocalDate(d);
                  const weekend = date.getDay() === 0 || date.getDay() === 6;
                  return (
                    <th
                      key={d}
                      className={cn(
                        "px-2 py-2.5 text-center font-medium",
                        d === today && "text-brand",
                        weekend && d !== today && "opacity-60"
                      )}
                    >
                      {dense ? (
                        date.getDate()
                      ) : (
                        <Fragment>
                          <span className="block uppercase tracking-wide">
                            {date.toLocaleDateString(undefined, { weekday: "short" })}
                          </span>
                          <span className="block text-[11px] font-normal">{date.getDate()}</span>
                        </Fragment>
                      )}
                    </th>
                  );
                })}
                <th className="px-5 py-2.5 text-right font-medium uppercase tracking-wide">Total</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-border last:border-0">
                  <td className="sticky left-0 z-10 bg-card px-5 py-2.5 whitespace-nowrap">
                    <span className="flex items-center gap-2 font-medium">
                      <span
                        className={cn("size-2 rounded-full", r.clockedIn ? "bg-[var(--pass)]" : "bg-border")}
                        title={r.clockedIn ? "On the clock" : "Clocked out"}
                      />
                      {r.name}
                    </span>
                    <span className="pl-4 text-xs text-muted-foreground">{ROLE_LABEL[r.role] ?? r.role}</span>
                  </td>
                  {days.map((d) => {
                    const s = r.perDay[d];
                    return (
                      <td key={d} className="px-1 py-2.5 text-center">
                        {s > 0 ? (
                          <Link
                            href="/team"
                            className={cn(
                              "tnum inline-flex items-center gap-0.5 rounded-md px-1.5 py-1 hover:bg-accent",
                              dense ? "text-[11px]" : "text-xs",
                              d === today && "text-brand"
                            )}
                            title={r.autoDays.has(d) ? "Includes a session closed automatically (forgot to clock out)" : undefined}
                          >
                            {dense ? hoursDecimal(s).replace(/\.?0+$/, "") : formatDuration(s)}
                            {r.autoDays.has(d) && <WarningIcon weight="fill" className="size-3 text-[var(--review)]" />}
                          </Link>
                        ) : (
                          <span className="text-muted-foreground/40">–</span>
                        )}
                      </td>
                    );
                  })}
                  <td className="tnum px-5 py-2.5 text-right font-semibold whitespace-nowrap">
                    {formatDuration(r.total)}
                    {r.worked > 0 && (
                      <span className="block text-xs font-normal text-muted-foreground">
                        {r.worked} day{r.worked === 1 ? "" : "s"} · avg {formatDuration(Math.round(r.total / r.worked))}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <label className="flex items-center gap-2 text-xs text-muted-foreground">
        <input type="checkbox" checked={everyone} onChange={(e) => setEveryone(e.target.checked)} className="accent-brand" />
        Show everyone, including people with no hours who aren&apos;t on the clocked roles
      </label>
    </div>
  );
}
