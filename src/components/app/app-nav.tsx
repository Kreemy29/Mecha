"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Wordmark } from "@/components/brand/logo";
import { NavLink } from "@/components/app/nav-link";
import { UserMenu } from "@/components/app/user-menu";
import { ClockButton } from "@/components/app/clock-button";
import { useMe } from "@/components/layout/me-context";
import { ROLE_LABEL } from "@/lib/roles";
import { isActive, visibleSections } from "@/lib/nav";

// The top bar, from OneUp Insights' AppNav: wordmark, one link per section
// (each section's own pages show as tabs underneath, see SectionNav), and the
// clock + account menu on the right. Sections a role can't open aren't shown.
export function AppNav() {
  const pathname = usePathname();
  const { me } = useMe();
  const sections = visibleSections(me);

  return (
    <header className="sticky top-0 z-40 border-b border-border/80 bg-card/85 backdrop-blur-md print:hidden">
      <div className="flex h-16 w-full items-center gap-6 px-4 sm:px-6">
        {/* The PNG logo's ink lettering disappears on a dark bar, so the
            typographic lockup is used here, as Insights does on dark. */}
        <Link href="/" className="shrink-0" aria-label="OneUp Studio home">
          <Wordmark label="Studio" tone="dark" className="text-lg" />
        </Link>

        <nav className="flex min-w-0 items-center gap-1 overflow-x-auto">
          {sections.map((s) => (
            <NavLink
              key={s.label}
              href={s.pages[0].href}
              active={s.pages.some((p) => isActive(pathname, p.href))}
            >
              {s.label}
            </NavLink>
          ))}
        </nav>

        {me ? (
          <div className="ml-auto flex shrink-0 items-center gap-2">
            <ClockButton />
            <UserMenu
              name={me.name}
              username={me.username}
              role={ROLE_LABEL[me.role] ?? me.role}
              isAdmin={me.isAdmin}
            />
          </div>
        ) : null}
      </div>
    </header>
  );
}
