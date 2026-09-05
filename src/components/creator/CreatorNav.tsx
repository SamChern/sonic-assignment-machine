import { Link, useLocation } from "react-router-dom";
import { ArrowLeft, BadgeCheck, Disc3, Store, UserRound } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * One shared bar across every Creator surface (door, profile, catalog, market)
 * so a creator never has to guess how to get from one to the next.
 */
const LINKS = [
  { to: "/creator", label: "Creator", icon: BadgeCheck },
  { to: "/creator/profile", label: "Profile", icon: UserRound },
  { to: "/library/catalog", label: "Catalog", icon: Disc3 },
  { to: "/market", label: "Market", icon: Store },
] as const;

export const CreatorNav = ({ className }: { className?: string }) => {
  const { pathname } = useLocation();

  return (
    <nav
      aria-label="Creator sections"
      className={cn(
        "-mx-1 flex items-center gap-1 overflow-x-auto px-1 pb-1 text-xs",
        className,
      )}
    >
      <Link
        to="/"
        className="flex shrink-0 items-center gap-1 rounded-full border border-border/60 px-3 py-1.5 text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Home
      </Link>
      {LINKS.map(({ to, label, icon: Icon }) => {
        const active = pathname === to;
        return (
          <Link
            key={to}
            to={to}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex shrink-0 items-center gap-1 rounded-full border px-3 py-1.5 transition-colors",
              active
                ? "border-primary/50 bg-primary/10 text-primary"
                : "border-border/60 text-muted-foreground hover:text-foreground",
            )}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
          </Link>
        );
      })}
    </nav>
  );
};

export default CreatorNav;
