import { can, NAV_FOR_ROLE, type Role } from "@/lib/roles";

// The app's navigation, OneUp Insights style: a handful of sections in the top
// bar, and each section's pages as tabs underneath (components/app/section-nav).

export interface NavPage {
  href: string;
  label: string;
}

export interface NavSection {
  label: string;
  pages: NavPage[];
}

export const SECTIONS: NavSection[] = [
  { label: "Dashboard", pages: [{ href: "/", label: "Jobs" }] },
  {
    label: "Department",
    pages: [
      { href: "/trends", label: "Trends" },
      { href: "/production", label: "Production" },
      { href: "/team", label: "Team" },
      { href: "/timesheets", label: "Timesheets" },
      { href: "/hours", label: "My hours" },
    ],
  },
  {
    label: "Instagram",
    pages: [
      { href: "/instagram", label: "Accounts & reels" },
      { href: "/requests", label: "Requests" },
      { href: "/formats", label: "Formats" },
    ],
  },
  {
    label: "Create",
    pages: [
      { href: "/images", label: "Images" },
      { href: "/seedance", label: "Seedance" },
      { href: "/motion-capture", label: "Motion capture" },
      { href: "/methods", label: "Methods" },
    ],
  },
  {
    label: "Library",
    pages: [
      { href: "/characters", label: "Characters" },
      { href: "/presets", label: "Presets" },
    ],
  },
  {
    label: "Settings",
    pages: [
      { href: "/settings", label: "Connections" },
      { href: "/tracker", label: "Work tracker" },
      { href: "/admin", label: "Accounts" },
    ],
  },
];

interface Who {
  role: Role;
  isAdmin: boolean;
}

// Whether a signed-in user should be offered this page. Convenience only: the
// API routes enforce the real permissions.
export function canSee(user: Who, href: string): boolean {
  if (href === "/team" || href === "/timesheets") return can.viewTeam(user);
  if (href === "/admin") return user.isAdmin;
  // Everyone clocks, so everyone gets their own hours and the tracker setup.
  if (href === "/tracker" || href === "/hours") return true;
  const allowed = NAV_FOR_ROLE[user.role];
  return !allowed || allowed.includes(href);
}

export function visibleSections(user: Who | null): NavSection[] {
  if (!user) return [];
  return SECTIONS.map((s) => ({ ...s, pages: s.pages.filter((p) => canSee(user, p.href)) })).filter(
    (s) => s.pages.length > 0
  );
}

export const isActive = (pathname: string, href: string) =>
  href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(href + "/");

export function sectionFor(pathname: string, sections: NavSection[]): NavSection | null {
  return sections.find((s) => s.pages.some((p) => isActive(pathname, p.href))) ?? null;
}
