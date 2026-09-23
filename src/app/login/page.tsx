"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ChartLineUpIcon,
  ShieldCheckIcon,
  SpinnerGapIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Wordmark } from "@/components/brand/logo";

// Layout copied from OneUp Insights' login: ink brand panel on the left,
// form on the right. The logic is Mecha's: username sign-in, plus the
// first-run form that creates the founding admin.
function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") || "/";

  const [needsSetup, setNeedsSetup] = useState<boolean | null>(null);
  const [needsToken, setNeedsToken] = useState(false);
  const [token, setToken] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(needsSetup ? "/api/auth/setup" : "/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          needsSetup ? { username, name, password, role: "owner", token } : { username, password }
        ),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      // Full navigation so server components re-read the new session cookie.
      window.location.href = needsSetup ? "/" : next;
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Sign in failed");
      setBusy(false);
    }
  };

  const canSubmit =
    username.trim().length > 0 &&
    password.length > 0 &&
    (!needsSetup || (password.length >= 8 && (!needsToken || token.trim().length > 0)));

  return (
    <main className="grid min-h-[100dvh] w-full lg:grid-cols-[1.05fr_1fr]">
      {/* Brand panel — ink ground, orange glow. Hidden on small screens. */}
      <section className="brand-panel relative hidden overflow-hidden bg-[#01171e] px-14 py-12 text-white lg:flex lg:flex-col">
        <div className="brand-glow" aria-hidden="true" />
        <div className="relative z-10 flex h-full flex-col">
          <Wordmark label="Studio" tone="dark" />

          <div className="mt-auto max-w-md">
            <h1 className="text-4xl font-semibold leading-[1.08] tracking-tight text-white">
              Research, create and ship in one place.
            </h1>
            <p className="mt-5 max-w-sm font-raleway text-[0.975rem] leading-relaxed text-white/65">
              {"OneUp Media's content studio: daily trend research, AI production for every model, and review before anything goes out."}
            </p>

            <ul className="mt-9 flex flex-col gap-3.5 text-sm text-white/75">
              <li className="flex items-center gap-3">
                <ChartLineUpIcon weight="bold" className="size-4 text-brand" />
                Daily trends, tasks and approvals
              </li>
              <li className="flex items-center gap-3">
                <ShieldCheckIcon weight="bold" className="size-4 text-brand" />
                Secure, role-based access
              </li>
            </ul>
          </div>

          <p className="relative z-10 mt-12 text-xs text-white/40">
            OneUp Media · internal content studio
          </p>
        </div>
      </section>

      {/* Form panel */}
      <section className="flex flex-col items-center justify-center px-6 py-12 sm:px-12">
        <div className="w-full max-w-sm">
          <div className="mb-9">
            <Wordmark label="Studio" tone="light" className="text-2xl lg:hidden" />
            <h2 className="mt-6 text-2xl font-semibold tracking-tight lg:mt-0">
              {needsSetup ? "Create the admin account" : "Sign in"}
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              {needsSetup
                ? "First run. This account can create everyone else."
                : "Use the account your team lead set up for you."}
            </p>
          </div>

          {needsSetup === null ? (
            <div className="flex justify-center py-12">
              <SpinnerGapIcon className="size-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <form onSubmit={submit} className="flex flex-col gap-5">
              {needsSetup && needsToken && (
                <div className="flex flex-col gap-2">
                  <Label htmlFor="token">Setup code</Label>
                  <Input
                    id="token"
                    value={token}
                    onChange={(e) => setToken(e.target.value)}
                    placeholder="from SETUP_TOKEN"
                    className="h-11"
                  />
                </div>
              )}

              {needsSetup && (
                <div className="flex flex-col gap-2">
                  <Label htmlFor="name">Your name</Label>
                  <Input
                    id="name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. Rayen"
                    className="h-11"
                  />
                </div>
              )}

              <div className="flex flex-col gap-2">
                <Label htmlFor="username">Username</Label>
                <Input
                  id="username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  autoComplete="username"
                  placeholder="Your username"
                  required
                  className="h-11"
                />
              </div>

              <div className="flex flex-col gap-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete={needsSetup ? "new-password" : "current-password"}
                  placeholder={needsSetup ? "At least 8 characters" : "Your password"}
                  required
                  className="h-11"
                />
              </div>

              {error ? (
                <p
                  role="alert"
                  className="flex items-center gap-2 rounded-lg border border-destructive/25 bg-destructive/5 px-3 py-2.5 text-sm text-destructive"
                >
                  <WarningCircleIcon weight="fill" className="size-4 shrink-0" />
                  {error}
                </p>
              ) : null}

              <Button
                type="submit"
                disabled={busy || !canSubmit}
                className="mt-1 h-11 w-full text-[0.95rem] font-semibold transition-transform active:scale-[0.99]"
              >
                {busy ? (
                  <>
                    <SpinnerGapIcon className="size-4 animate-spin" />
                    {needsSetup ? "Creating…" : "Signing in…"}
                  </>
                ) : needsSetup ? (
                  "Create account"
                ) : (
                  "Sign in"
                )}
              </Button>
            </form>
          )}

          <p className="mt-8 text-xs leading-relaxed text-muted-foreground">
            Access is limited to OneUp Media staff. Your role comes from your account, and only an
            admin can change it.
          </p>
        </div>
      </section>
    </main>
  );
}

// useSearchParams() makes this tree client-rendered, and Next refuses to
// prerender that without a boundary to fall back to.
export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center">
          <SpinnerGapIcon className="size-5 animate-spin text-muted-foreground" />
        </div>
      }
    >
      <LoginForm />
    </Suspense>
  );
}
