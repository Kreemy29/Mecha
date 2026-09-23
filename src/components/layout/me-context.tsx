"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { Role } from "@/lib/roles";
import { dayBounds, todayLocal } from "@/lib/day";

export interface Me {
  id: number;
  username: string;
  name: string;
  role: Role;
  isAdmin: boolean;
}

export interface ClockState {
  session: { id: number; clockIn: string; lastSeen: string } | null;
  todaySeconds: number;
  tracker: { hasKey: boolean; lastUsedAt: string | null };
}

interface MeContextValue {
  me: Me | null;
  loaded: boolean;
  clock: ClockState | null;
  setClock: (action: "in" | "out") => Promise<void>;
  refreshClock: () => Promise<void>;
}

const MeContext = createContext<MeContextValue>({
  me: null,
  loaded: false,
  clock: null,
  setClock: async () => {},
  refreshClock: async () => {},
});

export const useMe = () => useContext(MeContext);

const HEARTBEAT_MS = 60_000;

// One fetch of "who am I" + "am I on the clock" shared by the nav, the user
// chip and every page that gates on role or clock state. While clocked in and
// the tab is open, a heartbeat keeps the work session alive (see
// services/worktime.ts STALE_MS).
export function MeProvider({ children }: { children: React.ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [clock, setClockState] = useState<ClockState | null>(null);

  const refreshClock = useCallback(async () => {
    const { from, to } = dayBounds(todayLocal());
    const res = await fetch(`/api/clock?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
    if (res.ok) setClockState(await res.json());
  }, []);

  const setClock = useCallback(async (action: "in" | "out") => {
    const { from, to } = dayBounds(todayLocal());
    const res = await fetch("/api/clock", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, from, to }),
    });
    if (res.ok) setClockState(await res.json());
  }, []);

  useEffect(() => {
    fetch("/api/auth/session")
      .then((r) => r.json())
      .then((d) => {
        setMe(d.user ?? null);
        if (d.user) refreshClock();
      })
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, [refreshClock]);

  const onClock = !!clock?.session;
  useEffect(() => {
    if (!onClock) return;
    const beat = () => {
      if (document.visibilityState !== "visible") return;
      const { from, to } = dayBounds(todayLocal());
      fetch("/api/clock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "heartbeat", from, to }),
      })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => d && setClockState(d))
        .catch(() => {});
    };
    const t = setInterval(beat, HEARTBEAT_MS);
    return () => clearInterval(t);
  }, [onClock]);

  return (
    <MeContext.Provider value={{ me, loaded, clock, setClock, refreshClock }}>
      {children}
    </MeContext.Provider>
  );
}
