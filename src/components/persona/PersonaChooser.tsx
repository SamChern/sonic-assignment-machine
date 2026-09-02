/**
 * Step 16.0 — the one question asked on a first visit: "What brings you here?"
 * The answer picks a default door. Admins arrive by role and are never asked.
 */
import { useNavigate } from "react-router-dom";
import { Compass, Megaphone, Palette } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { PERSONAS, type Persona } from "@/hooks/usePersona";

const ICONS: Record<Persona, typeof Compass> = {
  curious: Compass,
  marketing: Megaphone,
  creator: Palette,
};

export const PersonaChooser = ({
  open,
  onChoose,
  onDismiss,
}: {
  open: boolean;
  onChoose: (p: Persona) => void | Promise<void>;
  onDismiss: () => void;
}) => {
  const navigate = useNavigate();

  const pick = async (p: Persona) => {
    await onChoose(p);
    const target = PERSONAS.find((x) => x.value === p)?.path;
    if (target && target !== "/?tab=listen") navigate(target);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onDismiss()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold">What brings you here?</DialogTitle>
          <DialogDescription>
            One question, once. It only sets your starting view — you can switch access levels
            any time from your menu.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 py-2">
          {PERSONAS.map((p) => {
            const Icon = ICONS[p.value];
            return (
              <button
                key={p.value}
                type="button"
                onClick={() => void pick(p.value)}
                className="flex items-start gap-3 rounded-xl border border-border bg-card/60 p-4 text-left transition-colors hover:border-primary/60 hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="mt-0.5 rounded-lg bg-primary/10 p-2 text-primary">
                  <Icon className="h-5 w-5" />
                </span>
                <span className="min-w-0">
                  <span className="block font-semibold text-foreground">{p.label}</span>
                  <span className="block text-sm text-muted-foreground">{p.blurb}</span>
                </span>
              </button>
            );
          })}
        </div>
        <div className="flex justify-end">
          <Button variant="ghost" size="sm" onClick={onDismiss}>
            Just looking
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default PersonaChooser;
