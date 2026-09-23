import Image from "next/image";
import { cn } from "@/lib/utils";

/** The full OneUp Media logo (ink + orange). Best on light surfaces. */
export function LogoMark({ className, priority }: { className?: string; priority?: boolean }) {
  return (
    <Image
      src="/brand/oneup-logo.png"
      alt="OneUp Media"
      width={1500}
      height={578}
      priority={priority}
      className={cn("h-8 w-auto", className)}
    />
  );
}

/**
 * Typographic lockup that reads on ANY background (the PNG's ink text vanishes
 * on dark grounds). "OneUp" with UP in brand orange, plus the product label.
 */
export function Wordmark({
  label = "Insights",
  tone = "dark",
  className,
}: {
  label?: string;
  tone?: "dark" | "light";
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-baseline gap-1.5 font-heading font-extrabold tracking-tight",
        className,
      )}
    >
      <span className="inline-flex items-baseline">
        <span className={tone === "dark" ? "text-white" : "text-foreground"}>One</span>
        <span className="text-brand">Up</span>
      </span>
      <span
        className={cn(
          "translate-y-[-0.5px] text-sm font-medium tracking-wide",
          tone === "dark" ? "text-white/60" : "text-muted-foreground",
        )}
      >
        {label}
      </span>
    </span>
  );
}
