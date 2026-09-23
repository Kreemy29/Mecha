"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Copy, Download, KeyRound, Loader2, Puzzle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useMe } from "@/components/layout/me-context";
import { PageHeader } from "@/components/department/shared";

// Setting up the Chrome work tracker: download the extension, load it, and
// connect it with a personal key generated here.
export default function TrackerPage() {
  const { clock, refreshClock } = useMe();
  const [key, setKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Server render has no window; the <code> showing it suppresses the
  // resulting hydration mismatch.
  const [origin] = useState(() =>
    typeof window === "undefined" ? "" : window.location.origin
  );

  const generate = async () => {
    if (clock?.tracker.hasKey && !confirm("Generate a new key? The old one stops working.")) return;
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

  return (
    <div className="space-y-6 max-w-2xl">
      <PageHeader
        title="Work tracker"
        subtitle="A small Chrome extension that logs which sites you work in while you're clocked in."
      />

      <div className="glass rounded-2xl p-5 space-y-2">
        <p className="text-sm font-medium flex items-center gap-2">
          <Puzzle className="h-4 w-4" /> Status
        </p>
        <p className="text-sm text-muted-foreground">
          {!clock?.tracker.hasKey
            ? "Not connected yet."
            : lastUsed
              ? `Connected. Last report ${new Date(lastUsed).toLocaleString()}.`
              : "Key generated, but the extension hasn't reported in yet."}
        </p>
      </div>

      <ol className="space-y-4 list-none">
        <Step n={1} title="Download the extension">
          <Button
            onClick={() => (window.location.href = "/api/tracker/extension")}
            variant="outline"
            className="rounded-xl border-white/10 gap-2"
          >
            <Download className="h-4 w-4" /> mecha-work-tracker.zip
          </Button>
          <p className="text-xs text-muted-foreground">Unzip it somewhere it can stay (e.g. Documents).</p>
        </Step>

        <Step n={2} title="Load it in Chrome">
          <p className="text-xs text-muted-foreground">
            Open <code className="text-foreground">chrome://extensions</code>, switch on{" "}
            <b>Developer mode</b> (top right), click <b>Load unpacked</b> and pick the unzipped{" "}
            <code className="text-foreground">mecha-work-tracker</code> folder. Pin it from the puzzle icon.
          </p>
        </Step>

        <Step n={3} title="Connect it">
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">In the extension popup, paste:</p>
            <div className="flex items-center gap-2 text-xs">
              <span className="text-muted-foreground w-24">App address</span>
              <code suppressHydrationWarning className="glass rounded-lg px-2 py-1 flex-1 truncate">
                {origin}
              </code>
              <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => copy(origin, "Address")}>
                <Copy className="h-3.5 w-3.5" />
              </Button>
            </div>
            <div className="flex items-center gap-2 text-xs">
              <span className="text-muted-foreground w-24">Tracker key</span>
              {key ? (
                <>
                  <code className="glass rounded-lg px-2 py-1 flex-1 truncate">{key}</code>
                  <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => copy(key, "Key")}>
                    <Copy className="h-3.5 w-3.5" />
                  </Button>
                </>
              ) : (
                <Button
                  size="sm"
                  onClick={generate}
                  disabled={busy}
                  className="rounded-lg bg-brand hover:bg-brand/90 text-brand-foreground gap-1.5"
                >
                  {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <KeyRound className="h-3.5 w-3.5" />}
                  {clock?.tracker.hasKey ? "Generate a new key" : "Generate my key"}
                </Button>
              )}
            </div>
            {key && (
              <p className="text-[11px] text-amber-300/80">
                {"Copy it now. It's only shown once."}
              </p>
            )}
          </div>
        </Step>
      </ol>

      <p className="text-xs text-muted-foreground">
        {"The extension only records while you're clocked in: the site and page title of the tab in front, when you go idle (2 minutes without input) and when you switch away from Chrome. Page addresses are stored without query strings. You can clock in and out from the extension too."}
      </p>
    </div>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <li className="glass rounded-2xl p-5 flex gap-4">
      <span className="h-7 w-7 shrink-0 rounded-full bg-brand/20 text-brand text-sm font-semibold flex items-center justify-center">
        {n}
      </span>
      <div className="space-y-2 min-w-0 flex-1">
        <p className="text-sm font-medium">{title}</p>
        {children}
      </div>
    </li>
  );
}
