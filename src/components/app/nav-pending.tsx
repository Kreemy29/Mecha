"use client";

import { useLinkStatus } from "next/link";
import { cn } from "@/lib/utils";

// The spinner a nav link shows between the tap and the server answering.
//
// ⚠ `useLinkStatus` COMES FROM `next/link` IN THIS VERSION, not `next/navigation`.
//
// ⚠ IT ONLY REPORTS WHILE RENDERED INSIDE A `<Link>`. Outside one it is permanently
// not-pending, so this must stay a CHILD of the link, never a sibling.
//
// Why every nav needs it: these routes read cookies for auth, so they are dynamic and
// cannot be prefetched — which is exactly the case the Next docs name for this hook.
// Until the server answers, a tapped link looks completely dead. On a phone over a slow
// link, and on 5 Sep when the API was wedged, that read as a broken app rather than a
// slow one, and people tapped again and again — each tap another request the server had
// to serve (§28.47).
//
// `loading.tsx` gives the DESTINATION its skeleton; this gives the link you actually
// touched something to say immediately. The two are complementary, not alternatives.
export function NavPending({ className }: { className?: string }) {
  const { pending } = useLinkStatus();
  if (!pending) return null;
  return (
    <span
      aria-hidden
      className={cn(
        "ml-1.5 inline-block size-3 shrink-0 animate-spin rounded-full",
        "border-[1.5px] border-current border-t-transparent align-[-1px] opacity-60",
        className,
      )}
    />
  );
}
