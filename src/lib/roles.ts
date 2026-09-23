// Roles and what each one may do. Kept free of server imports so client
// components (admin page, nav, user chip) and API routes share one list.
//
// Nav filtering below is convenience only — the real boundary is the
// permission checks in the API routes, which call these same helpers.

export const ROLES = [
  "owner",
  "ceo",
  "trend_researcher",
  "content_creator",
  "ai_artist",
  "meta_ads",
  "marketing_manager",
] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABEL: Record<Role, string> = {
  owner: "Developer / AI Content Manager",
  ceo: "CEO",
  trend_researcher: "Trend Researcher",
  content_creator: "Content Creator",
  ai_artist: "AI Artist",
  meta_ads: "Meta Ads",
  marketing_manager: "Marketing Manager",
};

export function isRole(value: unknown): value is Role {
  return ROLES.includes(value as Role);
}

interface Who {
  role: Role;
  isAdmin: boolean;
}

// Owner and admins run the department; the CEO sees everything and can
// approve research, but doesn't hand out production work.
const isManager = (u: Who) => u.isAdmin || u.role === "owner";

export const can = {
  suggestTrends: (u: Who) => isManager(u) || u.role === "trend_researcher",
  reviewTrends: (u: Who) => isManager(u) || u.role === "ceo",
  manageProduction: (u: Who) => isManager(u),
  viewAllProduction: (u: Who) => isManager(u) || u.role === "ceo",
  doProduction: (u: Who) =>
    u.role === "content_creator" || u.role === "ai_artist" || isManager(u),
  viewTeam: (u: Who) => isManager(u) || u.role === "ceo",
};

// Roles whose work is tracked against the clock: they must be clocked in to
// submit anything.
export const CLOCKED_ROLES: Role[] = ["trend_researcher", "content_creator"];

// Which nav entries each focused role sees. Roles not listed see everything.
export const NAV_FOR_ROLE: Partial<Record<Role, string[]>> = {
  trend_researcher: ["/trends", "/instagram"],
  content_creator: [
    "/production",
    "/methods",
    "/images",
    "/motion-capture",
    "/seedance",
    "/characters",
  ],
};
