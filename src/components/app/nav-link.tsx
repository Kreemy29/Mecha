"use client";

import Link from "next/link";
import { NavPending } from "@/components/app/nav-pending";
import { cn } from "@/lib/utils";

// Top-bar link, from OneUp Insights. `active` is passed in because a section
// link is active on any of its section's pages, not just its own href.
export function NavLink({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "relative rounded-md px-3 py-1.5 text-sm font-medium whitespace-nowrap transition-colors",
        // A touch has no hover, so the press itself has to be the feedback.
        // `active:` fires the moment a finger lands, before any navigation.
        "active:bg-accent",
        active
          ? "text-foreground"
          : "text-muted-foreground hover:text-foreground hover:bg-accent",
      )}
    >
      {children}
      <NavPending />
      {active ? (
        <span className="absolute inset-x-3 -bottom-[13px] h-0.5 rounded-full bg-brand" />
      ) : null}
    </Link>
  );
}
