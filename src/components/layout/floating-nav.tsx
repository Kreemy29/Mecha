"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Image,
  Video,
  Clapperboard,
  Users,
  Layers,
  Settings,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

const navItems = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/images", label: "Images", icon: Image },
  { href: "/talking-head", label: "Talking Head", icon: Video },
  { href: "/motion-capture", label: "Motion Capture", icon: Clapperboard },
  { href: "/characters", label: "Characters", icon: Users },
  { href: "/presets", label: "Presets", icon: Layers },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function FloatingNav() {
  const pathname = usePathname();

  return (
    <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50">
      <nav className="glass-strong flex items-center gap-1 rounded-2xl px-2 py-2 shadow-2xl shadow-black/20">
        {/* Logo */}
        <Link
          href="/"
          className="flex items-center gap-2 px-3 py-2 mr-1 rounded-xl hover:bg-white/5 transition-colors"
        >
          <Zap className="h-5 w-5 text-[oklch(0.75_0.15_270)]" />
          <span className="text-sm font-semibold tracking-tight">Mecha</span>
        </Link>

        <div className="w-px h-6 bg-white/10 mx-1" />

        {/* Nav Items */}
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive =
            pathname === item.href ||
            (item.href !== "/" && pathname.startsWith(item.href));

          return (
            <Tooltip key={item.href}>
              <TooltipTrigger
                render={
                  <Link
                    href={item.href}
                    className={cn(
                      "relative flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium transition-all duration-200",
                      isActive
                        ? "bg-[oklch(0.75_0.15_270_/_15%)] text-[oklch(0.85_0.12_270)] shadow-[inset_0_1px_0_oklch(1_0_0_/_10%)]"
                        : "text-muted-foreground hover:text-foreground hover:bg-white/5"
                    )}
                  />
                }
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span className="hidden lg:inline">{item.label}</span>
                {isActive && (
                  <span className="absolute -bottom-px left-3 right-3 h-px bg-gradient-to-r from-transparent via-[oklch(0.75_0.15_270)] to-transparent" />
                )}
              </TooltipTrigger>
              <TooltipContent
                side="bottom"
                className="lg:hidden glass-strong border-white/10"
              >
                {item.label}
              </TooltipContent>
            </Tooltip>
          );
        })}
      </nav>
    </div>
  );
}
