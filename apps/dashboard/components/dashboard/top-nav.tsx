import Link from "next/link";
import { Bot, ShieldAlert, ActivitySquare } from "lucide-react";
import { cn } from "@/lib/utils";

const links = [
  { href: "/dashboard", label: "Dashboard", icon: ActivitySquare },
  { href: "/incidents", label: "Incidents", icon: ShieldAlert }
];

export function TopNav({ currentPath }: { currentPath: string }) {
  return (
    <header className="sticky top-0 z-20 border-b border-border/80 bg-background/95 backdrop-blur">
      <div className="mx-auto flex w-full max-w-7xl items-center justify-between px-6 py-4">
        <div className="flex items-center gap-2">
          <Bot className="h-5 w-5 text-primary" />
          <p className="font-semibold tracking-tight">Agent Control Room</p>
        </div>
        <nav className="flex items-center gap-2">
          {links.map((link) => {
            const Icon = link.icon;
            return (
              <Link
                key={link.href}
                href={link.href}
                className={cn(
                  "inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium",
                  currentPath === link.href ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"
                )}
              >
                <Icon className="h-4 w-4" />
                {link.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
