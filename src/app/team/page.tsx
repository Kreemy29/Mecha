"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import { Globe, Moon, MonitorOff, Shield, Timer } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { can, ROLE_LABEL, type Role } from "@/lib/roles";
import { clockTime, dayBounds, formatDuration, todayLocal } from "@/lib/day";
import { useMe } from "@/components/layout/me-context";
import { DayPicker, PageHeader } from "@/components/department/shared";

interface Session {
  id: number;
  clockIn: string;
  clockOut: string | null;
  lastSeen: string;
  autoClosed: boolean;
}

interface TimelineEntry {
  kind: "browse" | "idle" | "away";
  domain: string | null;
  title: string | null;
  start: string;
  end: string;
}

interface PersonDay {
  id: number;
  name: string;
  role: Role;
  clockedIn: boolean;
  sessions: Session[];
  workedSeconds: number;
  tracker: { hasKey: boolean; lastUsedAt: string | null };
  activity: {
    browseSeconds: number;
    idleSeconds: number;
    awaySeconds: number;
    domains: Array<{ domain: string; seconds: number }>;
    lastActivityAt: string | null;
    pages?: Array<{ url: string; title: string; seconds: number }>;
    timeline?: TimelineEntry[];
  };
  trends: { total: number; approved: number; rejected: number; pending: number };
  items: { submitted: number; approved: number; rejected: number; open: number };
}

export default function TeamPage() {
  const { me, loaded } = useMe();
  const [date, setDate] = useState(todayLocal());
  const [people, setPeople] = useState<PersonDay[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState<number | null>(null);

  const load = useCallback(async () => {
    const { from, to } = dayBounds(date);
    const q = new URLSearchParams({ date, from, to });
    if (open) q.set("user", String(open));
    const res = await fetch(`/api/team?${q}`);
    const data = await res.json();
    setPeople(Array.isArray(data) ? data : []);
    setLoading(false);
  }, [date, open]);

  useEffect(() => {
    (async () => {
      await load();
    })();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, [load]);

  if (loaded && me && !can.viewTeam(me)) {
    return (
      <div className="glass rounded-2xl py-16 text-center space-y-2">
        <Shield className="h-6 w-6 mx-auto text-muted-foreground" />
        <p className="text-sm text-muted-foreground">Only managers and the CEO can see the team page.</p>
      </div>
    );
  }

  const sorted = [...people].sort(
    (a, b) => Number(b.clockedIn) - Number(a.clockedIn) || b.workedSeconds - a.workedSeconds
  );

  return (
    <div className="space-y-6">
      <PageHeader title="Team" subtitle="Who clocked in, what they worked on in Chrome, and what got approved.">
        <DayPicker date={date} onChange={(d) => { setDate(d); setLoading(true); }} />
      </PageHeader>

      {loading ? (
        <Skeleton className="h-64 rounded-2xl" />
      ) : (
        <div className="glass rounded-2xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[10px] uppercase tracking-wider text-muted-foreground border-b border-white/5">
                <th className="text-left font-medium px-4 py-2.5">Person</th>
                <th className="text-left font-medium px-3 py-2.5">Clock</th>
                <th className="text-right font-medium px-3 py-2.5">Worked</th>
                <th className="text-left font-medium px-3 py-2.5">Chrome</th>
                <th className="text-left font-medium px-3 py-2.5">Top sites</th>
                <th className="text-left font-medium px-3 py-2.5">Output</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((p) => {
                const first = p.sessions[0];
                const last = p.sessions[p.sessions.length - 1];
                const tracked = p.activity.browseSeconds + p.activity.idleSeconds + p.activity.awaySeconds;
                return (
                  <Fragment key={p.id}>
                    <tr
                      onClick={() => setOpen(open === p.id ? null : p.id)}
                      className={cn(
                        "border-b border-white/5 cursor-pointer hover:bg-white/[0.03] align-top",
                        open === p.id && "bg-white/[0.04]"
                      )}
                    >
                      <td className="px-4 py-3">
                        <p className="font-medium flex items-center gap-2">
                          <span
                            className={cn(
                              "h-2 w-2 rounded-full",
                              p.clockedIn ? "bg-emerald-400" : "bg-white/15"
                            )}
                          />
                          {p.name}
                        </p>
                        <p className="text-[11px] text-muted-foreground pl-4">{ROLE_LABEL[p.role] ?? p.role}</p>
                      </td>
                      <td className="px-3 py-3 text-xs text-muted-foreground whitespace-nowrap">
                        {first ? (
                          <>
                            {clockTime(first.clockIn)} →{" "}
                            {last.clockOut ? clockTime(last.clockOut) : <span className="text-emerald-300">now</span>}
                            {p.sessions.length > 1 && <span> · {p.sessions.length} sessions</span>}
                            {p.sessions.some((s) => s.autoClosed) && (
                              <p className="text-amber-300/80">forgot to clock out</p>
                            )}
                          </>
                        ) : (
                          "didn't clock in"
                        )}
                      </td>
                      <td className="px-3 py-3 text-right font-medium tabular-nums">
                        {p.workedSeconds ? formatDuration(p.workedSeconds) : "–"}
                      </td>
                      <td className="px-3 py-3 w-48">
                        {tracked > 0 ? (
                          <div className="space-y-1">
                            <div className="flex h-1.5 rounded-full overflow-hidden bg-white/5">
                              <div className="bg-emerald-400/80" style={{ width: `${(p.activity.browseSeconds / tracked) * 100}%` }} />
                              <div className="bg-amber-400/70" style={{ width: `${(p.activity.idleSeconds / tracked) * 100}%` }} />
                              <div className="bg-white/25" style={{ width: `${(p.activity.awaySeconds / tracked) * 100}%` }} />
                            </div>
                            <p className="text-[10px] text-muted-foreground flex gap-2">
                              <span className="text-emerald-300">{formatDuration(p.activity.browseSeconds)} active</span>
                              <span className="text-amber-300">{formatDuration(p.activity.idleSeconds)} idle</span>
                              <span>{formatDuration(p.activity.awaySeconds)} away</span>
                            </p>
                          </div>
                        ) : (
                          <span className="text-[11px] text-muted-foreground">
                            {p.tracker.hasKey ? "no activity" : "tracker not set up"}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex flex-wrap gap-1">
                          {p.activity.domains.slice(0, 4).map((d) => (
                            <Badge key={d.domain} className="bg-white/5 border-0 text-[10px] font-normal">
                              {d.domain} <span className="text-muted-foreground ml-1">{formatDuration(d.seconds)}</span>
                            </Badge>
                          ))}
                        </div>
                      </td>
                      <td className="px-3 py-3 text-[11px] text-muted-foreground space-y-0.5">
                        {p.trends.total > 0 && (
                          <p>
                            {p.trends.total} trends ·{" "}
                            <span className="text-emerald-300">{p.trends.approved} approved</span>
                            {p.trends.rejected > 0 && <span className="text-red-300"> · {p.trends.rejected} rejected</span>}
                          </p>
                        )}
                        {(p.items.submitted > 0 || p.items.approved > 0 || p.items.open > 0) && (
                          <p>
                            {p.items.submitted} handed in ·{" "}
                            <span className="text-emerald-300">{p.items.approved} approved</span>
                            {p.items.rejected > 0 && <span className="text-red-300"> · {p.items.rejected} rejected</span>}
                            {p.items.open > 0 && <span> · {p.items.open} open</span>}
                          </p>
                        )}
                      </td>
                    </tr>
                    {open === p.id && (
                      <tr className="border-b border-white/5 bg-white/[0.02]">
                        <td colSpan={6} className="px-4 py-4">
                          <PersonDetail person={p} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const KIND_ICON = { browse: Globe, idle: Moon, away: MonitorOff };

function PersonDetail({ person: p }: { person: PersonDay }) {
  const timeline = p.activity.timeline;
  const pages = p.activity.pages;
  if (!timeline || !pages) return <Skeleton className="h-24 rounded-xl" />;

  return (
    <div className="grid lg:grid-cols-3 gap-6">
      <div className="space-y-2">
        <p className="text-xs font-semibold flex items-center gap-1.5">
          <Timer className="h-3.5 w-3.5" /> Sessions
        </p>
        {p.sessions.length === 0 ? (
          <p className="text-xs text-muted-foreground">None.</p>
        ) : (
          p.sessions.map((s) => (
            <p key={s.id} className="text-xs text-muted-foreground">
              {clockTime(s.clockIn)} → {s.clockOut ? clockTime(s.clockOut) : "now"}
              {s.autoClosed && <span className="text-amber-300"> (auto-closed, last seen {clockTime(s.lastSeen)})</span>}
            </p>
          ))
        )}
      </div>

      <div className="space-y-2">
        <p className="text-xs font-semibold">Most time spent on</p>
        {pages.length === 0 ? (
          <p className="text-xs text-muted-foreground">No tracked pages.</p>
        ) : (
          pages.slice(0, 12).map((pg) => (
            <div key={pg.url} className="flex items-center gap-2 text-xs">
              <span className="truncate flex-1" title={pg.url}>
                {pg.title || pg.url}
              </span>
              <span className="text-muted-foreground tabular-nums">{formatDuration(pg.seconds)}</span>
            </div>
          ))
        )}
      </div>

      <div className="space-y-2">
        <p className="text-xs font-semibold">Timeline</p>
        <div className="max-h-64 overflow-y-auto space-y-0.5 pr-1">
          {timeline.length === 0 ? (
            <p className="text-xs text-muted-foreground">Nothing recorded.</p>
          ) : (
            timeline.map((e, idx) => {
              const Icon = KIND_ICON[e.kind];
              return (
                <div key={idx} className="flex items-center gap-2 text-[11px]">
                  <span className="text-muted-foreground tabular-nums w-10 shrink-0">{clockTime(e.start)}</span>
                  <Icon
                    className={cn(
                      "h-3 w-3 shrink-0",
                      e.kind === "browse" ? "text-emerald-300" : e.kind === "idle" ? "text-amber-300" : "text-muted-foreground"
                    )}
                  />
                  <span className="truncate">
                    {e.kind === "browse" ? e.title || e.domain : e.kind === "idle" ? "Idle" : "Outside Chrome"}
                  </span>
                  <span className="text-muted-foreground ml-auto shrink-0">
                    {formatDuration(Math.round((Date.parse(e.end) - Date.parse(e.start)) / 1000))}
                  </span>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
