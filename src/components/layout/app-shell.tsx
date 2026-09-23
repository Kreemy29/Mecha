"use client";

import { usePathname } from "next/navigation";
import { AppNav } from "@/components/app/app-nav";
import { SectionNav } from "@/components/app/section-nav";
import { MeProvider } from "@/components/layout/me-context";

// The login screen is its own full-bleed page — no nav, no padded container.
// Everything else gets the app chrome (layout from OneUp Insights' (app) shell).
export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  if (pathname === "/login") return <>{children}</>;

  return (
    <MeProvider>
      <div className="flex min-h-[100dvh] flex-col bg-background">
        <AppNav />
        <SectionNav />
        <main className="flex-1 w-full max-w-7xl mx-auto px-4 sm:px-6 py-8">{children}</main>
      </div>
    </MeProvider>
  );
}
