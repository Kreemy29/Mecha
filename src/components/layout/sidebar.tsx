"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Image,
  Clapperboard,
  Users,
  Layers,
  Settings,
  Shirt,
  History,
  Megaphone,
  LayoutGrid,
} from "lucide-react";
import { InstagramIcon } from "@/components/icons";
import { cn } from "@/lib/utils";

const navItems = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/instagram", label: "Instagram", icon: InstagramIcon },
  { href: "/requests", label: "Requests", icon: Megaphone },
  { href: "/images", label: "Images", icon: Image },
  { href: "/motion-capture", label: "Motion Capture", icon: Clapperboard },
  { href: "/methods", label: "Methods", icon: History },
  { href: "/formats", label: "Formats", icon: LayoutGrid },
  { href: "/seedance", label: "Seedance", icon: Shirt },
  { href: "/characters", label: "Characters", icon: Users },
  { href: "/presets", label: "Presets", icon: Layers },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="w-56 border-r border-border bg-card flex flex-col">
      <div className="p-4 border-b border-border">
        <h1 className="text-lg font-bold tracking-tight">Mecha AI</h1>
        <p className="text-xs text-muted-foreground">Content Automation</p>
      </div>
      <nav className="flex-1 p-2 space-y-0.5">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive =
            pathname === item.href ||
            (item.href !== "/" && pathname.startsWith(item.href));

          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors",
                isActive
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
              )}
            >
              <Icon className="h-4 w-4 shrink-0" />
              {item.label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
