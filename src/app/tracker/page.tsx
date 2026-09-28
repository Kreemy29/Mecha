"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  CheckCircleIcon,
  CopyIcon,
  DesktopIcon,
  DownloadSimpleIcon,
  EyeIcon,
  KeyIcon,
  ProhibitIcon,
  PuzzlePieceIcon,
  ShieldCheckIcon,
  SpinnerGapIcon,
  XCircleIcon,
} from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useMe } from "@/components/layout/me-context";
import { PageHeader } from "@/components/department/shared";
import {
  CONSENT_COLLECTED,
  CONSENT_NOT_COLLECTED,
  CONSENT_WHO_SEES,
} from "@/lib/tracking-consent";
import { cn } from "@/lib/utils";

interface Consent {
  accepted: boolean;
  acceptedAt: string | null;
  revokedAt: string | null;
  version: number | null;
  currentVersion: number;
}

// Activity tracking, permission first: nothing is recorded until the person
// agrees here (the server enforces it), then the key and the two trackers.
export default function TrackerPage() {
  const { clock, refreshClock } = useMe();
  const [consent, setConsent] = useState<Consent | null>(null);
  const [consentBusy, setConsentBusy] = useState(false);
  const [key, setKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Server render has no window; the <code> showing it suppresses the
  // resulting hydration mismatch.
  const [origin] = useState(() => (typeof window === "undefined" ? "" : window.location.origin));

  useEffect(() => {
    fetch("/api/tracker/consent")
      .then((r) => r.json())
      .then(setConsent)
      .catch(() => {});
  }, []);

  const answer = async (accept: boolean) => {
    if (!accept && !confirm("Withdraw permission? Both trackers stop recording straight away.")) return;
    setConsentBusy(true);
    try {
      const res = await fetch("/api/tracker/consent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accept }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setConsent(data);
      toast.success(accept ? "Thanks. Tracking is allowed while you're clocked in." : "Permission withdrawn. Nothing more is recorded.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "That didn't save");
    } finally {
      setConsentBusy(false);
    }
  };

  const generate = async () => {
    if (clock?.tracker.hasKey && !confirm("Generate a new key? The old one stops working on every tracker.")) return;
    setBusy(true);
    try {
      const res = await fetch("/api/tracker/key", { method: "POST" });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setKey(data.key);
      await refreshClock();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not generate a key");
    } finally {
      setBusy(false);
    }
  };

  const copy = (text: string, what: string) => {
    navigator.clipboard.writeText(text);
    toast.success(`${what} copied`);
  };

  const lastUsed = clock?.tracker.lastUsedAt;
  const allowed = !!consent?.accepted;

  return (
    <div className="max-w-3xl space-y-6">
      <PageHeader
        eyebrow="Settings"
        title="Work tracker"
        subtitle="See which apps and sites you work in while you're clocked in. It only runs with your permission."
      />

      {/* 1 · Permission */}
      <Card className="gap-0 overflow-hidden p-0">
        <div className="flex items-center gap-3 border-b border-border px-5 py-4">
          <span className="grid size-9 place-items-center rounded-lg bg-brand/10 text-brand">
            <ShieldCheckIcon weight="bold" className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-semibold">Your permission</h2>
            <p className="text-sm text-muted-foreground">Nothing is recorded until you agree.</p>
          </div>
          {consent === null ? (
            <Skeleton className="h-6 w-24 rounded-full" />
          ) : (
            <span
              className={cn(
                "inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium",
                allowed ? "bg-[var(--pass)]/12 text-[var(--pass)]" : "bg-secondary text-muted-foreground"
              )}
            >
              {allowed ? <CheckCircleIcon weight="fill" className="size-3.5" /> : <XCircleIcon className="size-3.5" />}
              {allowed ? "Allowed" : consent.revokedAt ? "Withdrawn" : "Not given"}
            </span>
          )}
        </div>

        <div className="grid gap-5 p-5 sm:grid-cols-2">
          <div className="space-y-2">
            <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <EyeIcon className="size-3.5" /> What is recorded
            </p>
            <ul className="space-y-2 text-sm">
              {CONSENT_COLLECTED.map((t) => (
                <li key={t} className="flex gap-2">
                  <CheckCircleIcon weight="fill" className="mt-0.5 size-4 shrink-0 text-chart-2" />
                  <span>{t}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="space-y-2">
            <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <ProhibitIcon className="size-3.5" /> Never recorded
            </p>
            <ul className="space-y-2 text-sm">
              {CONSENT_NOT_COLLECTED.map((t) => (
                <li key={t} className="flex gap-2">
                  <ProhibitIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                  <span>{t}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 border-t border-border bg-secondary/30 px-5 py-4">
          <p className="min-w-0 flex-1 text-xs text-muted-foreground">
            {CONSENT_WHO_SEES}
            {allowed && consent?.acceptedAt && ` You agreed on ${new Date(consent.acceptedAt).toLocaleString()}.`}
          </p>
          {consent !== null &&
            (allowed ? (
              <Button variant="outline" onClick={() => answer(false)} disabled={consentBusy} className="gap-1.5">
                {consentBusy && <SpinnerGapIcon className="size-4 animate-spin" />}
                Withdraw permission
              </Button>
            ) : (
              <Button
                onClick={() => answer(true)}
                disabled={consentBusy}
                className="gap-1.5 bg-brand text-brand-foreground hover:bg-brand/90"
              >
                {consentBusy ? <SpinnerGapIcon className="size-4 animate-spin" /> : <CheckCircleIcon weight="bold" className="size-4" />}
                Allow tracking
              </Button>
            ))}
        </div>
      </Card>

      <div className={cn("space-y-6 transition-opacity", !allowed && "pointer-events-none select-none opacity-45")}>
        {!allowed && consent !== null && (
          <p className="text-sm text-muted-foreground">Give permission above to set up the trackers.</p>
        )}

        {/* 2 · Key */}
        <Card className="gap-0 p-5">
          <div className="flex items-center gap-3">
            <span className="grid size-9 place-items-center rounded-lg bg-secondary text-muted-foreground">
              <KeyIcon weight="bold" className="size-5" />
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="text-base font-semibold">Connection details</h2>
              <p className="text-sm text-muted-foreground">
                {!clock?.tracker.hasKey
                  ? "Generate your key, then paste these into the tracker."
                  : lastUsed
                    ? `Connected. Last report ${new Date(lastUsed).toLocaleString()}.`
                    : "Key generated. No tracker has reported in yet."}
              </p>
            </div>
          </div>
          <div className="mt-4 space-y-2 text-sm">
            <Row label="OneUp address">
              <code suppressHydrationWarning className="min-w-0 flex-1 truncate rounded-md bg-secondary px-2 py-1">
                {origin}
              </code>
              <Button size="icon-sm" variant="ghost" onClick={() => copy(origin, "Address")} title="Copy">
                <CopyIcon className="size-4" />
              </Button>
            </Row>
            <Row label="Tracker key">
              {key ? (
                <>
                  <code className="min-w-0 flex-1 truncate rounded-md bg-secondary px-2 py-1">{key}</code>
                  <Button size="icon-sm" variant="ghost" onClick={() => copy(key, "Key")} title="Copy">
                    <CopyIcon className="size-4" />
                  </Button>
                </>
              ) : (
                <Button size="sm" onClick={generate} disabled={busy} className="gap-1.5 bg-brand text-brand-foreground hover:bg-brand/90">
                  {busy ? <SpinnerGapIcon className="size-4 animate-spin" /> : <KeyIcon className="size-4" />}
                  {clock?.tracker.hasKey ? "Generate a new key" : "Generate my key"}
                </Button>
              )}
            </Row>
            {key && <p className="text-xs text-[var(--review)]">{"Copy it now. It's only shown once, and works for both trackers."}</p>}
          </div>
        </Card>

        {/* 3 · Trackers */}
        <div className="grid gap-4 md:grid-cols-2">
          <TrackerCard
            Icon={DesktopIcon}
            title="Desktop tracker (Windows)"
            blurb="The apps you work in: CapCut, Photoshop, Premiere…"
            download="/api/tracker/extension?kind=desktop"
            file="OneUp-Tracker.zip"
            steps={[
              "Download and unzip it somewhere it can stay (e.g. Documents).",
              "If Windows blocks it: right-click the zip > Properties > Unblock, then unzip again.",
              "Double-click “Start OneUp Tracker.cmd”, paste the address and key above, tick the agreement and click “Allow and connect”.",
              "It lives in the tray by the clock. Right-click it to pause, quit or disconnect.",
            ]}
          />
          <TrackerCard
            Icon={PuzzlePieceIcon}
            title="Chrome extension"
            blurb="The websites and tabs you use in Chrome."
            download="/api/tracker/extension"
            file="mecha-work-tracker.zip"
            steps={[
              "Download and unzip it somewhere it can stay.",
              "Open chrome://extensions, turn on Developer mode, click Load unpacked and pick the unzipped folder.",
              "Pin it, open it, and paste the address and key above.",
            ]}
          />
        </div>
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-28 shrink-0 text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}

function TrackerCard({
  Icon,
  title,
  blurb,
  download,
  file,
  steps,
}: {
  Icon: typeof DesktopIcon;
  title: string;
  blurb: string;
  download: string;
  file: string;
  steps: string[];
}) {
  return (
    <Card className="gap-0 p-5">
      <div className="flex items-center gap-3">
        <span className="grid size-9 place-items-center rounded-lg bg-brand/10 text-brand">
          <Icon weight="bold" className="size-5" />
        </span>
        <div className="min-w-0">
          <h2 className="text-base font-semibold">{title}</h2>
          <p className="text-sm text-muted-foreground">{blurb}</p>
        </div>
      </div>
      <ol className="mt-4 space-y-2 text-sm">
        {steps.map((s, i) => (
          <li key={i} className="flex gap-2.5">
            <span className="tnum grid size-5 shrink-0 place-items-center rounded-full bg-secondary text-[11px] font-semibold">
              {i + 1}
            </span>
            <span>{s}</span>
          </li>
        ))}
      </ol>
      <Button variant="outline" onClick={() => (window.location.href = download)} className="mt-4 gap-1.5 self-start">
        <DownloadSimpleIcon className="size-4" /> {file}
      </Button>
    </Card>
  );
}
