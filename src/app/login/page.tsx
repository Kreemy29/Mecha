"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import {
  Zap,
  Crown,
  Sparkles,
  Megaphone,
  BarChart3,
  Loader2,
  ArrowLeft,
  LogIn,
} from "lucide-react";

type Role = "owner" | "ai_artist" | "meta_ads" | "marketing_manager";

const ROLES: {
  key: Role;
  label: string;
  blurb: string;
  icon: React.ComponentType<{ className?: string }>;
}[] = [
  { key: "owner", label: "Owner", blurb: "Full view of everything", icon: Crown },
  {
    key: "ai_artist",
    label: "AI Artist",
    blurb: "Characters, stills and video",
    icon: Sparkles,
  },
  {
    key: "meta_ads",
    label: "Meta Ads",
    blurb: "Paid creative and ad requests",
    icon: Megaphone,
  },
  {
    key: "marketing_manager",
    label: "Marketing Manager",
    blurb: "Reels, planning and requests",
    icon: BarChart3,
  },
];

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") || "/";

  const [needsSetup, setNeedsSetup] = useState<boolean | null>(null);
  const [needsToken, setNeedsToken] = useState(false);
  const [token, setToken] = useState("");
  const [picked, setPicked] = useState<Role | null>(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/auth/session")
      .then((r) => r.json())
      .then((d) => {
        setNeedsSetup(!!d.needsSetup);
        setNeedsToken(!!d.needsSetupToken);
        if (d.user) router.replace(next);
      })
      .catch(() => setNeedsSetup(false));
  }, [router, next]);

  const signIn = async () => {
    setBusy(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      toast.success(`Welcome back, ${data.user.name}`);
      // Full navigation so server components re-read the new session cookie.
      window.location.href = next;
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Sign in failed");
      setBusy(false);
    }
  };

  const createFirst = async () => {
    setBusy(true);
    try {
      const res = await fetch("/api/auth/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username,
          name,
          password,
          role: picked ?? "owner",
          token,
        }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      toast.success("Account created — you're the admin");
      window.location.href = "/";
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Could not create account");
      setBusy(false);
    }
  };

  const submit = needsSetup ? createFirst : signIn;
  const canSubmit =
    username.trim().length > 0 &&
    password.length > 0 &&
    (!needsSetup || (password.length >= 8 && (!needsToken || token.trim().length > 0)));

  return (
    <div className="min-h-screen flex items-center justify-center px-6">
      <div className="w-full max-w-2xl space-y-8">
        {/* Wordmark */}
        <div className="text-center space-y-3">
          <div className="inline-flex items-center gap-2.5">
            <span className="h-11 w-11 rounded-2xl bg-[oklch(0.75_0.15_270_/_15%)] flex items-center justify-center">
              <Zap className="h-6 w-6 text-[oklch(0.75_0.15_270)]" />
            </span>
            <span className="text-4xl font-bold tracking-tight bg-gradient-to-r from-foreground to-foreground/60 bg-clip-text text-transparent">
              OneUp
            </span>
          </div>
          <p className="text-sm text-muted-foreground">
            {needsSetup
              ? "First run — create the founding admin account."
              : picked
                ? `Signing in as ${ROLES.find((r) => r.key === picked)!.label}`
                : "Welcome. Choose your role to sign in."}
          </p>
        </div>

        {needsSetup === null ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : !picked && !needsSetup ? (
          // ── Role picker ──
          <div className="grid sm:grid-cols-2 gap-3">
            {ROLES.map((r) => {
              const Icon = r.icon;
              return (
                <button
                  key={r.key}
                  onClick={() => setPicked(r.key)}
                  className="glass hover:bg-white/5 rounded-2xl p-4 text-left transition-all group"
                >
                  <span className="flex items-center gap-3">
                    <span className="h-9 w-9 rounded-xl bg-white/5 flex items-center justify-center group-hover:bg-[oklch(0.75_0.15_270_/_15%)] transition-colors">
                      <Icon className="h-4 w-4" />
                    </span>
                    <span>
                      <span className="block text-sm font-medium">{r.label}</span>
                      <span className="block text-[11px] text-muted-foreground">
                        {r.blurb}
                      </span>
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        ) : (
          // ── Credentials ──
          <div className="glass-strong rounded-2xl p-6 space-y-4 max-w-md mx-auto">
            {needsSetup && needsToken && (
              <div className="space-y-2">
                <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Setup code
                </label>
                <Input
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  placeholder="from SETUP_TOKEN"
                  className="glass border-white/10"
                />
              </div>
            )}

            {needsSetup && (
              <div className="space-y-2">
                <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Your name
                </label>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Rayen"
                  className="glass border-white/10"
                />
              </div>
            )}

            <div className="space-y-2">
              <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Username
              </label>
              <Input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
                className="glass border-white/10"
              />
            </div>

            <div className="space-y-2">
              <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Password
              </label>
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && canSubmit && submit()}
                autoComplete={needsSetup ? "new-password" : "current-password"}
                className="glass border-white/10"
              />
              {needsSetup && (
                <p className="text-[10px] text-muted-foreground">
                  At least 8 characters.
                </p>
              )}
            </div>

            <Button
              onClick={submit}
              disabled={busy || !canSubmit}
              className="w-full rounded-xl bg-[oklch(0.75_0.15_270)] hover:bg-[oklch(0.7_0.15_270)] text-white gap-2"
            >
              {busy ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <LogIn className="h-4 w-4" />
              )}
              {needsSetup ? "Create account" : "Sign in"}
            </Button>

            {!needsSetup && (
              <button
                onClick={() => setPicked(null)}
                className="w-full text-[11px] text-muted-foreground hover:text-foreground inline-flex items-center justify-center gap-1"
              >
                <ArrowLeft className="h-3 w-3" /> Pick a different role
              </button>
            )}

            <p className="text-[10px] text-muted-foreground text-center pt-1">
              {needsSetup
                ? "This account gets admin access and can create everyone else."
                : "Your role comes from your account — an admin sets it."}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

// useSearchParams() makes this tree client-rendered, and Next refuses to
// prerender that without a boundary to fall back to.
export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      }
    >
      <LoginForm />
    </Suspense>
  );
}
