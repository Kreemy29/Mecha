"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { LogOut, Shield, User as UserIcon } from "lucide-react";

interface Me {
  id: number;
  username: string;
  name: string;
  role: "owner" | "ai_artist" | "meta_ads" | "marketing_manager";
  isAdmin: boolean;
}

const ROLE_LABEL: Record<Me["role"], string> = {
  owner: "Owner",
  ai_artist: "AI Artist",
  meta_ads: "Meta Ads",
  marketing_manager: "Marketing Manager",
};

// Who's signed in, top-right. Also the only way out — without a sign-out the
// session cookie lives for 30 days on a shared machine.
export function UserChip() {
  const [me, setMe] = useState<Me | null>(null);

  useEffect(() => {
    fetch("/api/auth/session")
      .then((r) => r.json())
      .then((d) => setMe(d.user ?? null))
      .catch(() => {});
  }, []);

  const signOut = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  };

  if (!me) return null;

  return (
    <div className="fixed top-4 right-4 z-50 flex items-center gap-1.5 glass-strong rounded-2xl px-2 py-1.5 shadow-2xl shadow-black/20">
      <span className="flex items-center gap-2 px-1.5">
        <UserIcon className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-xs font-medium">{me.name}</span>
        <span className="text-[10px] text-muted-foreground hidden sm:inline">
          {ROLE_LABEL[me.role]}
        </span>
      </span>
      {me.isAdmin && (
        <Link
          href="/admin"
          title="Manage accounts"
          className="h-7 w-7 rounded-lg hover:bg-white/10 flex items-center justify-center text-muted-foreground hover:text-foreground"
        >
          <Shield className="h-3.5 w-3.5" />
        </Link>
      )}
      <button
        onClick={signOut}
        title="Sign out"
        className="h-7 w-7 rounded-lg hover:bg-white/10 flex items-center justify-center text-muted-foreground hover:text-foreground"
      >
        <LogOut className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
