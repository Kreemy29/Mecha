"use client";

import { usePathname } from "next/navigation";
import { FloatingNav } from "@/components/layout/floating-nav";
import { UserChip } from "@/components/layout/user-chip";

// The login screen is its own full-bleed page — no nav, no padded container.
// Everything else gets the app chrome.
export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  if (pathname === "/login") return <>{children}</>;

  return (
    <div className="min-h-screen flex flex-col">
      <FloatingNav />
      <UserChip />
      <main className="flex-1 w-full max-w-7xl mx-auto px-6 pt-24 pb-8">
        {children}
      </main>
    </div>
  );
}
