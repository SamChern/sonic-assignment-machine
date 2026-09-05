import { Link, useLocation, useSearchParams } from "react-router-dom";
import { PlayCircle, Headphones, Activity, Library, Shield, Building2, User, LogIn } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useOrganization } from "@/hooks/useOrganization";
import { cn } from "@/lib/utils";
import { normalizeTab } from "@/lib/homeTabs";

type NavItem = {
  key: string;
  label: string;
  to: string;
  icon: typeof Headphones;
  isActive: (pathname: string, tab: string) => boolean;
};

/**
 * The bar mirrors the three real home tabs (listen / understand / library) so
 * the highlighted item always matches the surface on screen. Earlier labels
 * ("Upload", "Compare") pointed at tab names that no longer exist.
 */
const ITEMS: NavItem[] = [
  {
    key: "listen",
    label: "Listen",
    to: "/?tab=listen",
    icon: Headphones,
    isActive: (p, tab) => p === "/" && tab === "listen",
  },
  {
    key: "understand",
    label: "Analyse",
    to: "/?tab=understand",
    icon: Activity,
    isActive: (p, tab) => p === "/" && tab === "understand",
  },
  {
    key: "library",
    label: "Library",
    to: "/?tab=library",
    icon: Library,
    isActive: (p, tab) => p === "/" && tab === "library",
  },
  {
    key: "demo",
    label: "Demo",
    to: "/demo",
    icon: PlayCircle,
    isActive: (p) => p === "/demo",
  },
  {
    key: "enterprise",
    label: "Enterprise",
    to: "/workspace",
    icon: Building2,
    isActive: (p) => p === "/workspace",
  },
  {
    key: "admin",
    label: "Admin",
    to: "/admin",
    icon: Shield,
    isActive: (p) => p.startsWith("/admin"),
  },
  {
    key: "account",
    label: "Account",
    to: "/auth",
    icon: User,
    isActive: (p) => p === "/auth",
  },
  {
    key: "signin",
    label: "Sign in",
    to: "/auth",
    icon: LogIn,
    isActive: (p) => p === "/auth",
  },
];

/** Sticky mobile-only quick navigation. Hidden from sm breakpoint upwards. */
export function MobileBottomNav() {
  const { pathname } = useLocation();
  const [searchParams] = useSearchParams();
  const { user, isAdmin } = useAuth();
  const { orgs } = useOrganization();
  const hasOrg = orgs.length > 0;
  const tab = pathname === "/" ? normalizeTab(searchParams.get("tab")) : "";

  if (pathname === "/auth") return null;

  const items = ITEMS.filter((item) => {
    // Signed out: always offer a way into sign-in / admin / enterprise login.
    if (item.key === "signin") return !user;
    if (item.key === "account") return !!user;
    if (item.key === "admin") return isAdmin;
    if (item.key === "enterprise") return !!user && hasOrg;
    // Demo is a marketing surface: keep it for visitors, drop it once a signed-in
    // user has real doors, so the bar never crowds past five items on a phone.
    if (item.key === "demo") return !user;
    return true;
  });


  return (
    <nav
      aria-label="Quick navigation"
      className="z-nav fixed bottom-0 left-0 right-0 safe-bottom border-t border-border/60 bg-background/95 backdrop-blur-md sm:hidden"
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
                data-active={active ? "true" : undefined}
                className={cn(
                  "relative flex min-h-14 flex-col items-center justify-center gap-1 px-2 py-2 text-[11px] font-medium transition-colors",
                  active
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {/* Active indicator: top rail so the current section is obvious. */}
                <span
                  aria-hidden="true"
                  className={cn(
                    "pointer-events-none absolute inset-x-2 top-0 h-0.5 rounded-full transition-opacity",
                    active ? "bg-primary opacity-100" : "opacity-0",
                  )}
                />
                <Icon className="h-5 w-5" aria-hidden="true" />
                <span className={cn(active && "font-semibold")}>{item.label}</span>
              </Link>
            </li>
          );
        })}

      </ul>
    </nav>
  );
}

export default MobileBottomNav;
