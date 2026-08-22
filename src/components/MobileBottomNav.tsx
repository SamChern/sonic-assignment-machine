import { Link, useLocation, useSearchParams } from "react-router-dom";
import { PlayCircle, Upload, GitCompare, Shield } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { cn } from "@/lib/utils";

type NavItem = {
  key: string;
  label: string;
  to: string;
  icon: typeof Upload;
  isActive: (pathname: string, tab: string | null) => boolean;
};

const ITEMS: NavItem[] = [
  {
    key: "demo",
    label: "Demo",
    to: "/demo",
    icon: PlayCircle,
    isActive: (p) => p === "/demo",
  },
  {
    key: "upload",
    label: "Upload",
    to: "/?tab=select",
    icon: Upload,
    isActive: (p, tab) => p === "/" && tab !== "discover",
  },
  {
    key: "compare",
    label: "Compare",
    to: "/?tab=discover",
    icon: GitCompare,
    isActive: (p, tab) => p === "/" && tab === "discover",
  },
  {
    key: "admin",
    label: "Admin",
    to: "/admin",
    icon: Shield,
    isActive: (p) => p.startsWith("/admin"),
  },
];

/** Sticky mobile-only quick navigation. Hidden from sm breakpoint upwards. */
export function MobileBottomNav() {
  const { pathname } = useLocation();
  const [searchParams] = useSearchParams();
  const { isAdmin } = useAuth();
  const tab = searchParams.get("tab");

  if (pathname === "/auth") return null;

  const items = ITEMS.filter((item) => item.key !== "admin" || isAdmin);

  return (
    <nav
      aria-label="Quick navigation"
      className="fixed bottom-0 left-0 right-0 z-40 safe-bottom border-t border-border/60 bg-background/95 backdrop-blur-md sm:hidden"
    >
      <ul className="flex items-stretch justify-around">
        {items.map((item) => {
          const active = item.isActive(pathname, tab);
          const Icon = item.icon;
          return (
            <li key={item.key} className="flex-1">
              <Link
                to={item.to}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex min-h-14 flex-col items-center justify-center gap-1 px-2 py-2 text-[11px] font-medium transition-colors",
                  active
                    ? "text-primary"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <Icon className="h-5 w-5" aria-hidden="true" />
                <span>{item.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export default MobileBottomNav;
