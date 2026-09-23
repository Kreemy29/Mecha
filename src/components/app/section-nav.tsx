"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NavPending } from "@/components/app/nav-pending";
import { useMe } from "@/components/layout/me-context";
import { isActive, sectionFor, visibleSections } from "@/lib/nav";
import { cn } from "@/lib/utils";

// Tabs for the pages inside the current section, the twin of Insights'
// AnalyticsNav. Hidden when the section has a single page.
export function SectionNav() {
  const pathname = usePathname();
  const { me } = useMe();
  const section = sectionFor(pathname, visibleSections(me));
  if (!section || section.pages.length < 2) return null;

  return (
    <div className="border-b border-border/70 bg-card/40 print:hidden">
      <div className="flex w-full gap-1 overflow-x-auto px-4 sm:px-6">
        {section.pages.map(({ href, label }) => {
          const active = isActive(pathname, href);
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "relative -mb-px shrink-0 border-b-2 px-3 py-3 text-sm font-medium transition-colors",
                // A touch has no hover, so the press itself has to be the feedback.
                "active:bg-secondary/70",
                active
                  ? "border-brand text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {label}
              <NavPending />
            </Link>
          );
        })}
      </div>
    </div>
  );
}
