"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  BellRingingIcon,
  CheckCircleIcon,
  EnvelopeSimpleIcon,
  KeyIcon,
  ShieldCheckIcon,
  SpinnerGapIcon,
  TelegramLogoIcon,
  TrashIcon,
  UserPlusIcon,
  XCircleIcon,
} from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/department/shared";
import { ROLES as ROLE_KEYS, ROLE_LABEL, type Role } from "@/lib/roles";
import { cn } from "@/lib/utils";

const ROLES: { key: Role; label: string }[] = ROLE_KEYS.map((key) => ({ key, label: ROLE_LABEL[key] }));

interface User {
  id: number;
  username: string;
  name: string;
  role: Role;
  isAdmin: boolean;
  email: string | null;
  telegramUsername: string | null;
  telegramConnected: boolean;
}

interface Channels {
  telegram: boolean;
  email: boolean;
  bot: string | null;
}

interface Diagnostics {
  service: string | null;
  externalUrl: string | null;
  commit: string | null;
  startedAt: string;
  env: Record<string, { set: boolean; length: number }>;
}

export default function AdminPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [me, setMe] = useState<User | null>(null);
  const [denied, setDenied] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [channels, setChannels] = useState<Channels | null>(null);
  const [diag, setDiag] = useState<Diagnostics | null>(null);
  const [hooking, setHooking] = useState(false);

  const [username, setUsername] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<Role>("content_creator");
  const [password, setPassword] = useState("");
  const [email, setEmail] = useState("");
  const [telegram, setTelegram] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);

  const load = useCallback(async () => {
    try {
      const [u, s, c, d] = await Promise.all([
        fetch("/api/users").then((r) => r.json()),
        fetch("/api/auth/session").then((r) => r.json()),
        fetch("/api/telegram").then((r) => r.json()).catch(() => null),
        fetch("/api/diagnostics").then((r) => (r.ok ? r.json() : null)).catch(() => null),
      ]);
      if (u.error) setDenied(true);
      else setUsers(u);
      setMe(s.user ?? null);
      setChannels(c);
      setDiag(d);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    (async () => {
      await load();
    })();
  }, [load]);

  const create = async () => {
    setBusy(true);
    try {
      const res = await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, name, role, password, isAdmin, email, telegramUsername: telegram }),
      });
      const row = await res.json();
      if (row.error) throw new Error(row.error);
      setUsers((prev) => [...prev, row]);
      setUsername("");
      setName("");
      setPassword("");
      setEmail("");
      setTelegram("");
      setIsAdmin(false);
      toast.success(`Created ${row.name}`);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Could not create");
    } finally {
      setBusy(false);
    }
  };

  const patch = async (id: number, body: Record<string, unknown>) => {
    const res = await fetch("/api/users", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, ...body }),
    });
    const row = await res.json();
    if (row.error) {
      toast.error(row.error);
      return false;
    }
    setUsers((prev) => prev.map((u) => (u.id === id ? row : u)));
    return true;
  };

  const resetPassword = async (u: User) => {
    const pw = window.prompt(`New password for ${u.name} (min 8 characters):`);
    if (!pw) return;
    if (await patch(u.id, { password: pw })) toast.success(`Password reset. ${u.name} is signed out everywhere.`);
  };

  const remove = async (u: User) => {
    if (!confirm(`Delete ${u.name}'s account?`)) return;
    const res = await fetch(`/api/users?id=${u.id}`, { method: "DELETE" });
    const data = await res.json();
    if (data.error) {
      toast.error(data.error);
      return;
    }
    setUsers((prev) => prev.filter((x) => x.id !== u.id));
  };

  const connectWebhook = async () => {
    setHooking(true);
    try {
      const res = await fetch("/api/telegram", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "setup" }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      toast.success("Telegram bot connected to this app");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't connect the bot");
    } finally {
      setHooking(false);
    }
  };

  if (loading) {
    return <Skeleton className="h-64 rounded-2xl" />;
  }

  if (denied) {
    return (
      <Card className="items-center gap-2 py-16 text-center">
        <ShieldCheckIcon className="size-6 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">Admins only. Ask an admin if you need access here.</p>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Settings"
        title="Accounts"
        subtitle="Create accounts, assign roles, and set where each person's notifications go."
      />

      {/* Notification channels */}
      <Card className="gap-0 p-5">
        <div className="flex flex-wrap items-center gap-3">
          <span className="grid size-9 place-items-center rounded-lg bg-brand/10 text-brand">
            <BellRingingIcon weight="bold" className="size-5" />
          </span>
          <div className="min-w-[14rem] flex-1">
            <h2 className="text-base font-semibold">Notifications</h2>
            <p className="text-sm text-muted-foreground">
              Workflow messages go out on Telegram and by email, to whoever has them set up.
            </p>
          </div>
          <Channel on={!!channels?.telegram} label={channels?.bot ? `Telegram @${channels.bot}` : "Telegram"} Icon={TelegramLogoIcon} />
          <Channel on={!!channels?.email} label="Gmail" Icon={EnvelopeSimpleIcon} />
          {channels?.telegram && (
            <Button variant="outline" size="sm" onClick={connectWebhook} disabled={hooking} className="gap-1.5">
              {hooking && <SpinnerGapIcon className="size-4 animate-spin" />}
              Connect bot webhook
            </Button>
          )}
        </div>
        {(!channels?.telegram || !channels?.email) && (
          <p className="mt-3 rounded-lg bg-secondary/50 px-3 py-2 text-xs text-muted-foreground">
            {!channels?.telegram && "Telegram: set TELEGRAM_BOT_TOKEN on the server (from @BotFather), then click “Connect bot webhook”. "}
            {!channels?.email && "Email: set GMAIL_USER and GMAIL_APP_PASSWORD (a Google App Password) on the server."}
          </p>
        )}
        {diag && (
          <details className="mt-3 rounded-lg border border-border px-3 py-2 text-xs">
            <summary className="cursor-pointer font-medium text-muted-foreground">
              Server check: which deploy is running and which settings it can see
            </summary>
            <div className="mt-2 space-y-2">
              <p className="text-muted-foreground">
                Service <b className="text-foreground">{diag.service ?? "(not on Render)"}</b>
                {diag.externalUrl && <> at {diag.externalUrl}</>}
                {diag.commit && <> · deploy <b className="text-foreground">{diag.commit}</b></>}
                {" · "}started {new Date(diag.startedAt).toLocaleString()}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(diag.env).map(([k, v]) => (
                  <span
                    key={k}
                    className={cn(
                      "rounded-md px-2 py-0.5 font-mono text-[11px]",
                      v.set ? "bg-[var(--pass)]/12 text-[var(--pass)]" : "bg-destructive/10 text-destructive"
                    )}
                  >
                    {k}: {v.set ? `set (${v.length} chars)` : "missing"}
                  </span>
                ))}
              </div>
              <p className="text-muted-foreground">
                {"If a value shows “missing” here but is in Render's Environment page, that page isn't this service's, or it was saved without deploying."}
              </p>
            </div>
          </details>
        )}
      </Card>

      {/* New account */}
      <Card className="gap-0 p-5">
        <p className="flex items-center gap-2 text-base font-semibold">
          <UserPlusIcon weight="bold" className="size-4 text-brand" /> New account
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name" />
          <Input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Username (to sign in)" />
          <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password (min 8)" />
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Work email" />
          <Input value={telegram} onChange={(e) => setTelegram(e.target.value)} placeholder="Telegram @username" />
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as Role)}
            className="h-8 w-full rounded-lg border border-input bg-transparent px-2 text-sm"
          >
            {ROLES.map((r) => (
              <option key={r.key} value={r.key}>
                {r.label}
              </option>
            ))}
          </select>
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
          <label className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
            <input type="checkbox" checked={isAdmin} onChange={(e) => setIsAdmin(e.target.checked)} className="accent-brand" />
            Admin: can manage accounts
          </label>
          <Button
            onClick={create}
            disabled={busy || !username.trim() || password.length < 8}
            className="gap-2 bg-brand text-brand-foreground hover:bg-brand/90"
          >
            {busy ? <SpinnerGapIcon className="size-4 animate-spin" /> : <UserPlusIcon className="size-4" />}
            Create account
          </Button>
        </div>
      </Card>

      {/* Accounts */}
      <Card className="gap-0 overflow-x-auto p-0">
        <table className="w-full min-w-[900px] text-sm">
          <thead>
            <tr className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
              <th className="px-5 py-2.5 text-left font-medium">Person</th>
              <th className="px-3 py-2.5 text-left font-medium">Role</th>
              <th className="px-3 py-2.5 text-left font-medium">Work email</th>
              <th className="px-3 py-2.5 text-left font-medium">Telegram</th>
              <th className="px-3 py-2.5 text-center font-medium">Admin</th>
              <th className="px-5 py-2.5" />
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-b border-border last:border-0">
                <td className="px-5 py-2.5">
                  <p className="font-medium">
                    {u.name}
                    {me?.id === u.id && <span className="ml-2 rounded-full bg-secondary px-1.5 py-0.5 text-[10px]">you</span>}
                  </p>
                  <p className="text-xs text-muted-foreground">@{u.username}</p>
                </td>
                <td className="px-3 py-2.5">
                  <select
                    value={u.role}
                    onChange={(e) => patch(u.id, { role: e.target.value })}
                    className="h-8 rounded-lg border border-input bg-transparent px-2 text-sm"
                  >
                    {ROLES.map((r) => (
                      <option key={r.key} value={r.key}>
                        {r.label}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="px-3 py-2.5">
                  <InlineField
                    value={u.email}
                    placeholder="name@oneupmedia.io"
                    onSave={(v) => patch(u.id, { email: v })}
                  />
                </td>
                <td className="px-3 py-2.5">
                  <div className="flex items-center gap-2">
                    <InlineField
                      value={u.telegramUsername ? `@${u.telegramUsername}` : null}
                      placeholder="@username"
                      onSave={(v) => patch(u.id, { telegramUsername: v })}
                    />
                    <span
                      title={u.telegramConnected ? "Connected to the bot" : "Not connected yet: they press Connect Telegram on their profile"}
                      className={cn("shrink-0", u.telegramConnected ? "text-[var(--pass)]" : "text-muted-foreground/50")}
                    >
                      {u.telegramConnected ? <CheckCircleIcon weight="fill" className="size-4" /> : <XCircleIcon className="size-4" />}
                    </span>
                  </div>
                </td>
                <td className="px-3 py-2.5 text-center">
                  <input
                    type="checkbox"
                    checked={u.isAdmin}
                    onChange={(e) => patch(u.id, { isAdmin: e.target.checked })}
                    className="accent-brand"
                  />
                </td>
                <td className="px-5 py-2.5">
                  <div className="flex justify-end gap-1">
                    <Button size="icon-sm" variant="ghost" onClick={() => resetPassword(u)} title="Set a new password">
                      <KeyIcon className="size-4" />
                    </Button>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      onClick={() => remove(u)}
                      disabled={me?.id === u.id}
                      title={me?.id === u.id ? "You can't delete yourself" : "Delete account"}
                      className="hover:text-destructive"
                    >
                      <TrashIcon className="size-4" />
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

function Channel({ on, label, Icon }: { on: boolean; label: string; Icon: typeof TelegramLogoIcon }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium",
        on ? "bg-[var(--pass)]/12 text-[var(--pass)]" : "bg-secondary text-muted-foreground"
      )}
    >
      <Icon weight="fill" className="size-3.5" />
      {label} · {on ? "set up" : "not set up"}
    </span>
  );
}

// Text that saves when you leave the field (or press Enter), and only if it changed.
function InlineField({
  value,
  placeholder,
  onSave,
}: {
  value: string | null;
  placeholder: string;
  onSave: (v: string) => Promise<boolean>;
}) {
  const [draft, setDraft] = useState(value ?? "");
  const [saving, setSaving] = useState(false);
  const commit = async () => {
    if (draft.trim() === (value ?? "")) return;
    setSaving(true);
    const ok = await onSave(draft.trim());
    setSaving(false);
    if (!ok) setDraft(value ?? "");
  };
  return (
    <Input
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
      placeholder={placeholder}
      disabled={saving}
      className="h-8 min-w-44 text-sm"
    />
  );
}
