"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  CheckCircleIcon,
  EnvelopeSimpleIcon,
  PaperPlaneTiltIcon,
  SpinnerGapIcon,
  TelegramLogoIcon,
} from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/department/shared";
import { ROLE_LABEL, type Role } from "@/lib/roles";
import { cn } from "@/lib/utils";

interface Profile {
  id: number;
  name: string;
  username: string;
  role: Role;
  email: string | null;
  telegramUsername: string | null;
  telegramConnected: boolean;
}

interface Channels {
  telegram: boolean;
  email: boolean;
  bot: string | null;
}

// Your own contact details: where OneUp's workflow messages reach you.
export default function ProfilePage() {
  const [p, setP] = useState<Profile | null>(null);
  const [channels, setChannels] = useState<Channels | null>(null);
  const [email, setEmail] = useState("");
  const [telegram, setTelegram] = useState("");
  const [saving, setSaving] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    Promise.all([
      fetch("/api/profile").then((r) => r.json()),
      fetch("/api/telegram").then((r) => r.json()).catch(() => null),
    ]).then(([me, c]) => {
      setP(me);
      setEmail(me.email ?? "");
      setTelegram(me.telegramUsername ? `@${me.telegramUsername}` : "");
      setChannels(c);
    });
  }, []);

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, telegramUsername: telegram }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setP(data);
      toast.success("Saved");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't save");
    } finally {
      setSaving(false);
    }
  };

  const connect = async () => {
    setConnecting(true);
    try {
      const res = await fetch("/api/telegram", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "connect" }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      window.open(data.url, "_blank", "noopener");
      toast.message("Press Start in Telegram, then come back and refresh this page.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't open Telegram");
    } finally {
      setConnecting(false);
    }
  };

  const test = async () => {
    setTesting(true);
    try {
      const res = await fetch("/api/profile", { method: "POST" });
      const r = await res.json();
      if (r.error) throw new Error(r.error);
      if (r.telegram + r.email === 0) {
        toast.error("Nothing was sent: connect Telegram or add a work email first.");
      } else {
        toast.success(
          `Sent to ${[r.telegram ? "Telegram" : null, r.email ? "email" : null].filter(Boolean).join(" and ")}.`
        );
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Test failed");
    } finally {
      setTesting(false);
    }
  };

  if (!p) return <Skeleton className="h-72 rounded-2xl" />;

  const dirty = email.trim() !== (p.email ?? "") || telegram.trim().replace(/^@/, "") !== (p.telegramUsername ?? "");

  return (
    <div className="max-w-2xl space-y-6">
      <PageHeader
        eyebrow="Settings"
        title="My profile"
        subtitle="Where OneUp tells you when there's work for you: Telegram, email, or both."
      />

      <Card className="gap-0 p-5">
        <div className="flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-full bg-foreground text-sm font-semibold text-background">
            {p.name.split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase()}
          </span>
          <div>
            <p className="font-semibold">{p.name}</p>
            <p className="text-sm text-muted-foreground">
              @{p.username} · {ROLE_LABEL[p.role] ?? p.role}
            </p>
          </div>
        </div>

        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <label className="space-y-1.5">
            <span className="text-xs font-medium text-muted-foreground">Work email</span>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@oneupmedia.io" />
          </label>
          <label className="space-y-1.5">
            <span className="text-xs font-medium text-muted-foreground">Telegram username</span>
            <Input value={telegram} onChange={(e) => setTelegram(e.target.value)} placeholder="@username" />
          </label>
        </div>
        <div className="mt-4 flex justify-end">
          <Button onClick={save} disabled={saving || !dirty} className="gap-1.5 bg-brand text-brand-foreground hover:bg-brand/90">
            {saving && <SpinnerGapIcon className="size-4 animate-spin" />}
            Save
          </Button>
        </div>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card className="gap-0 p-5">
          <div className="flex items-center gap-2">
            <TelegramLogoIcon weight="fill" className="size-5 text-[#29a9eb]" />
            <h2 className="text-base font-semibold">Telegram</h2>
            <Status on={p.telegramConnected} />
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            {!channels?.telegram
              ? "The bot isn't set up on the server yet. Ask an admin."
              : p.telegramConnected
                ? `Connected${channels.bot ? ` to @${channels.bot}` : ""}. Messages arrive in that chat.`
                : "Open the bot and press Start once. That links this chat to your account."}
          </p>
          {channels?.telegram && (
            <Button variant="outline" onClick={connect} disabled={connecting} className="mt-4 gap-1.5 self-start">
              {connecting ? <SpinnerGapIcon className="size-4 animate-spin" /> : <TelegramLogoIcon className="size-4" />}
              {p.telegramConnected ? "Reconnect Telegram" : "Connect Telegram"}
            </Button>
          )}
        </Card>

        <Card className="gap-0 p-5">
          <div className="flex items-center gap-2">
            <EnvelopeSimpleIcon weight="fill" className="size-5 text-brand" />
            <h2 className="text-base font-semibold">Email</h2>
            <Status on={!!p.email && !!channels?.email} />
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            {!channels?.email
              ? "Email sending isn't set up on the server yet. Ask an admin."
              : p.email
                ? `Messages go to ${p.email}.`
                : "Add your work email above."}
          </p>
        </Card>
      </div>

      <Button variant="outline" onClick={test} disabled={testing} className="gap-1.5">
        {testing ? <SpinnerGapIcon className="size-4 animate-spin" /> : <PaperPlaneTiltIcon className="size-4" />}
        Send me a test message
      </Button>
    </div>
  );
}

function Status({ on }: { on: boolean }) {
  return (
    <span
      className={cn(
        "ml-auto inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium",
        on ? "bg-[var(--pass)]/12 text-[var(--pass)]" : "bg-secondary text-muted-foreground"
      )}
    >
      {on && <CheckCircleIcon weight="fill" className="size-3" />}
      {on ? "On" : "Off"}
    </span>
  );
}
