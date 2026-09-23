"use client";

// Account menu, from OneUp Insights: a plain toggled panel (no portal, no
// positioner), because Base UI's dropdown crashed some Chromium builds there.
// Mecha adds the Work tracker and Accounts links.
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  CaretDownIcon,
  PuzzlePieceIcon,
  ShieldCheckIcon,
  SignOutIcon,
  SpinnerGapIcon,
  TimerIcon,
} from "@phosphor-icons/react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

function initials(name: string): string {
  return name
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

export function UserMenu({
  name,
  username,
  role,
  isAdmin,
}: {
  name: string;
  username: string;
  role: string;
  isAdmin: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // close on outside click / Escape
  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const signOut = async () => {
    setPending(true);
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  };

  const item =
    "flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-sm transition-colors hover:bg-accent";

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="flex items-center gap-2 rounded-full py-1 pl-1 pr-2 text-sm outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Avatar className="size-8">
          <AvatarFallback className="bg-foreground text-[0.7rem] font-semibold text-background">
            {initials(name)}
          </AvatarFallback>
        </Avatar>
        <span className="hidden font-medium sm:inline">{name}</span>
        <CaretDownIcon
          className={cn("size-3.5 text-muted-foreground transition-transform", open && "rotate-180")}
        />
      </button>

      {open ? (
        <div
          role="menu"
          className="absolute right-0 top-full z-50 mt-2 w-60 rounded-xl border border-border bg-popover p-1.5 text-popover-foreground shadow-lg"
        >
          <div className="px-2.5 py-2">
            <p className="text-sm font-semibold">{name}</p>
            <p className="truncate text-xs text-muted-foreground">@{username}</p>
            <span className="mt-1.5 inline-block rounded-full bg-brand/10 px-2 py-0.5 text-[0.7rem] font-medium text-brand">
              {role}
            </span>
          </div>
          <div className="my-1 h-px bg-border" />
          <Link href="/hours" role="menuitem" onClick={() => setOpen(false)} className={item}>
            <TimerIcon className="size-4" />
            My hours
          </Link>
          <Link href="/tracker" role="menuitem" onClick={() => setOpen(false)} className={item}>
            <PuzzlePieceIcon className="size-4" />
            Work tracker
          </Link>
          {isAdmin ? (
            <Link href="/admin" role="menuitem" onClick={() => setOpen(false)} className={item}>
              <ShieldCheckIcon className="size-4" />
              Manage accounts
            </Link>
          ) : null}
          <div className="my-1 h-px bg-border" />
          <button
            type="button"
            role="menuitem"
            disabled={pending}
            onClick={signOut}
            className={cn(item, "disabled:opacity-60")}
          >
            {pending ? (
              <SpinnerGapIcon className="size-4 animate-spin" />
            ) : (
              <SignOutIcon className="size-4" />
            )}
            Sign out
          </button>
        </div>
      ) : null}
    </div>
  );
}
