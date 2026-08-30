/**
 * Step 16.0 — switch doors from the avatar menu. Personas are view preferences,
 * so every door is always available to everyone; admin/enterprise links only
 * appear when the role actually grants them.
 */
import { Link, useNavigate } from "react-router-dom";
import { Building2, Check, Compass, DoorOpen, LogOut, Megaphone, Palette, Shield, User } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { PERSONAS, type Persona } from "@/hooks/usePersona";

const ICONS: Record<Persona, typeof Compass> = {
  curious: Compass,
  marketing: Megaphone,
  creator: Palette,
};

export const DoorSwitcher = ({
  persona,
  onSelect,
  isSignedIn,
  isAdmin,
  hasEnterprise,
  avatarUrl,
  displayName,
  onSignOut,
}: {
  persona: Persona | null;
  onSelect: (p: Persona) => void | Promise<void>;
  isSignedIn: boolean;
  isAdmin: boolean;
  hasEnterprise: boolean;
  avatarUrl?: string | null;
  displayName?: string | null;
  onSignOut?: () => void;
}) => {
  const navigate = useNavigate();

  const pick = async (p: Persona) => {
    await onSelect(p);
    const target = PERSONAS.find((x) => x.value === p)?.path ?? "/";
    navigate(target);
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {isSignedIn ? (
          <button
            type="button"
            aria-label="Account and doors"
            className="flex items-center gap-2 rounded-full p-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Avatar className="h-8 w-8">
              <AvatarImage src={avatarUrl || undefined} />
              <AvatarFallback>
                <User className="h-4 w-4" />
              </AvatarFallback>
            </Avatar>
            <span className="hidden text-sm font-medium text-foreground sm:inline">
              {displayName}
            </span>
          </button>
        ) : (
          <Button variant="ghost" size="sm" className="gap-2 text-foreground/80">
            <DoorOpen className="h-4 w-4" />
            <span className="hidden sm:inline">Doors</span>
          </Button>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64 bg-popover">
        <DropdownMenuLabel>Switch door</DropdownMenuLabel>
        {PERSONAS.map((p) => {
          const Icon = ICONS[p.value];
          return (
            <DropdownMenuItem key={p.value} onClick={() => void pick(p.value)} className="gap-2">
              <Icon className="h-4 w-4 text-primary" />
              <span className="flex-1 truncate">{p.label}</span>
              {persona === p.value && <Check className="h-4 w-4 text-primary" />}
            </DropdownMenuItem>
          );
        })}
        {(hasEnterprise || isAdmin) && <DropdownMenuSeparator />}
        {hasEnterprise && (
          <DropdownMenuItem asChild>
            <Link to="/workspace" className="gap-2">
              <Building2 className="h-4 w-4 text-primary" />
              Enterprise workspace
            </Link>
          </DropdownMenuItem>
        )}
        {isAdmin && (
          <DropdownMenuItem asChild>
            <Link to="/admin" className="gap-2">
              <Shield className="h-4 w-4 text-primary" />
              Admin dashboard
            </Link>
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        {isSignedIn ? (
          <DropdownMenuItem onClick={onSignOut} className="gap-2">
            <LogOut className="h-4 w-4" />
            Sign out
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem asChild>
            <Link to="/auth" className="gap-2">
              <User className="h-4 w-4" />
              Sign in
            </Link>
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export default DoorSwitcher;
