"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Shield, Loader2, Trash2, UserPlus, KeyRound } from "lucide-react";

type Role = "owner" | "ai_artist" | "meta_ads" | "marketing_manager";

const ROLES: { key: Role; label: string }[] = [
  { key: "owner", label: "Owner" },
  { key: "ai_artist", label: "AI Artist" },
  { key: "meta_ads", label: "Meta Ads" },
  { key: "marketing_manager", label: "Marketing Manager" },
];

interface User {
  id: number;
  username: string;
  name: string;
  role: Role;
  isAdmin: boolean;
}

export default function AdminPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [me, setMe] = useState<User | null>(null);
  const [denied, setDenied] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const [username, setUsername] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<Role>("ai_artist");
  const [password, setPassword] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);

  const load = useCallback(async () => {
    try {
      const [u, s] = await Promise.all([
        fetch("/api/users").then((r) => r.json()),
        fetch("/api/auth/session").then((r) => r.json()),
      ]);
      if (u.error) {
        setDenied(true);
      } else {
        setUsers(u);
      }
      setMe(s.user ?? null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const create = async () => {
    setBusy(true);
    try {
      const res = await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, name, role, password, isAdmin }),
      });
      const row = await res.json();
      if (row.error) throw new Error(row.error);
      setUsers((prev) => [...prev, row]);
      setUsername("");
      setName("");
      setPassword("");
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
      return;
    }
    setUsers((prev) => prev.map((u) => (u.id === id ? row : u)));
  };

  const resetPassword = async (u: User) => {
    const pw = window.prompt(`New password for ${u.name} (min 8 characters):`);
    if (!pw) return;
    const res = await fetch("/api/users", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: u.id, password: pw }),
    });
    const row = await res.json();
    if (row.error) toast.error(row.error);
    else toast.success(`Password reset — ${u.name} is signed out everywhere`);
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

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (denied) {
    return (
      <Card>
        <CardContent className="py-16 text-center space-y-2">
          <Shield className="h-6 w-6 mx-auto text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            Admins only. Ask an admin if you need access here.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl font-bold tracking-tight bg-gradient-to-r from-foreground to-foreground/60 bg-clip-text text-transparent">
          Accounts
        </h2>
        <p className="text-sm text-muted-foreground mt-1">
          Create accounts and assign roles. Nobody picks their own role.
        </p>
      </div>

      <Card>
        <CardContent className="p-4 space-y-3">
          <p className="text-sm font-medium flex items-center gap-2">
            <UserPlus className="h-4 w-4" /> New account
          </p>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-2">
            <Input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="username"
              className="glass border-white/10 h-9 text-sm"
            />
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="display name"
              className="glass border-white/10 h-9 text-sm"
            />
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as Role)}
              className="w-full glass border border-white/10 rounded-md h-9 px-2 text-sm bg-transparent"
            >
              {ROLES.map((r) => (
                <option key={r.key} value={r.key} className="bg-neutral-900">
                  {r.label}
                </option>
              ))}
            </select>
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="password (min 8)"
              className="glass border-white/10 h-9 text-sm"
            />
          </div>
          <div className="flex items-center justify-between flex-wrap gap-2">
            <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
              <input
                type="checkbox"
                checked={isAdmin}
                onChange={(e) => setIsAdmin(e.target.checked)}
                className="accent-[oklch(0.75_0.15_270)]"
              />
              Admin — can manage accounts
            </label>
            <Button
              onClick={create}
              disabled={busy || !username.trim() || password.length < 8}
              className="rounded-xl bg-[oklch(0.75_0.15_270)] hover:bg-[oklch(0.7_0.15_270)] text-white gap-2"
            >
              {busy ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <UserPlus className="h-4 w-4" />
              )}
              Create
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="space-y-2">
        {users.map((u) => (
          <Card key={u.id}>
            <CardContent className="p-3 flex items-center gap-3 flex-wrap">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium truncate">
                  {u.name}{" "}
                  <span className="text-muted-foreground font-normal">
                    @{u.username}
                  </span>
                  {me?.id === u.id && (
                    <Badge className="ml-2 text-[10px] bg-white/5 border-white/10">
                      you
                    </Badge>
                  )}
                </p>
              </div>
              <select
                value={u.role}
                onChange={(e) => patch(u.id, { role: e.target.value })}
                className="glass border border-white/10 rounded-md h-8 px-2 text-xs bg-transparent"
              >
                {ROLES.map((r) => (
                  <option key={r.key} value={r.key} className="bg-neutral-900">
                    {r.label}
                  </option>
                ))}
              </select>
              <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
                <input
                  type="checkbox"
                  checked={u.isAdmin}
                  onChange={(e) => patch(u.id, { isAdmin: e.target.checked })}
                  className="accent-[oklch(0.75_0.15_270)]"
                />
                admin
              </label>
              <Button
                size="sm"
                variant="outline"
                onClick={() => resetPassword(u)}
                title="Set a new password"
                className="rounded-xl border-white/10 px-2"
              >
                <KeyRound className="h-3.5 w-3.5" />
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => remove(u)}
                disabled={me?.id === u.id}
                title={
                  me?.id === u.id ? "You can't delete yourself" : "Delete account"
                }
                className="rounded-xl border-white/10 px-2 hover:bg-red-500/20"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
