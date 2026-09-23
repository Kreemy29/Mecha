// Local-calendar-day helpers. Daily work is filed under the user's own date
// ("YYYY-MM-DD" in their timezone), and time ranges sent to the server are
// that day's local midnight-to-midnight as ISO instants.

const pad = (n: number) => String(n).padStart(2, "0");

export function toLocalDate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export const todayLocal = () => toLocalDate(new Date());

export function parseLocalDate(date: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(date: string, n: number): string {
  const d = parseLocalDate(date);
  d.setDate(d.getDate() + n);
  return toLocalDate(d);
}

export function dayBounds(date: string): { from: string; to: string } {
  const start = parseLocalDate(date);
  const end = parseLocalDate(addDays(date, 1));
  return { from: start.toISOString(), to: end.toISOString() };
}

export function prettyDate(date: string): string {
  return parseLocalDate(date).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

export function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h === 0) return `${m}m`;
  return `${h}h ${pad(m)}m`;
}

// Monday of the week containing `date`.
export function startOfWeek(date: string): string {
  const day = (parseLocalDate(date).getDay() + 6) % 7;
  return addDays(date, -day);
}

export const startOfMonth = (date: string) => `${date.slice(0, 8)}01`;

export function endOfMonth(date: string): string {
  const d = parseLocalDate(startOfMonth(date));
  d.setMonth(d.getMonth() + 1);
  d.setDate(0);
  return toLocalDate(d);
}

// Every date from `from` to `to`, inclusive.
export function daysBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

// ISO bounds covering whole local days `from`..`to`.
export function rangeBounds(from: string, to: string): { from: string; to: string } {
  return { from: dayBounds(from).from, to: dayBounds(to).to };
}

interface SessionLike {
  clockIn: string;
  clockOut: string | null;
  lastSeen: string;
}

// Seconds of `s` inside [from, to). An open session counts to its last
// heartbeat, matching the server's secondsWithin.
export function sessionSecondsWithin(s: SessionLike, from: string, to: string): number {
  const start = Math.max(Date.parse(s.clockIn), Date.parse(from));
  const end = Math.min(Date.parse(s.clockOut ?? s.lastSeen), Date.parse(to));
  return Math.max(0, Math.round((end - start) / 1000));
}

// Worked seconds per local day. A session that crosses midnight is split
// across the two days.
export function secondsByDay(sessions: SessionLike[], days: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const d of days) {
    const { from, to } = dayBounds(d);
    out[d] = sessions.reduce((sum, s) => sum + sessionSecondsWithin(s, from, to), 0);
  }
  return out;
}

export function secondsSince(iso: string): number {
  return Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
}

export function clockTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}
