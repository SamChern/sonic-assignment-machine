import { Link } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowRight, Palette } from "lucide-react";

const LINKS = [
  {
    to: "/creator",
    label: "Your Creator view",
    description: "Your own work, how it reads, and who it lands with.",
  },
  {
    to: "/catalog",
    label: "Library",
    description: "Everything you and others have added, ready to compare.",
  },
  {
    to: "/methodology",
    label: "How it reads sound",
    description: "The six things we listen for, in plain language.",
  },
];

/** Shown once an application is approved: where to go next. */
const CreatorWorkspaceCard = () => (
  <Card className="border-primary/30 p-6">
    <div className="flex items-center gap-2">
      <Palette className="h-4 w-4 text-primary" aria-hidden="true" />
      <h2 className="text-lg font-semibold text-foreground">Your Creator space is open</h2>
    </div>
    <p className="mt-1 text-sm text-muted-foreground">
      Add your work, see what makes it distinct, and set your licence terms.
    </p>
    <div className="mt-4 grid gap-3 sm:grid-cols-3">
      {LINKS.map((link) => (
        <div key={link.to} className="rounded-lg border border-border/60 p-4">
          <p className="text-sm font-medium text-foreground">{link.label}</p>
          <p className="mt-1 text-xs text-muted-foreground">{link.description}</p>
          <Button asChild variant="ghost" size="sm" className="mt-2 -ml-2">
            <Link to={link.to}>
              Open
              <ArrowRight className="ml-1.5 h-3.5 w-3.5" aria-hidden="true" />
            </Link>
          </Button>
        </div>
      ))}
    </div>
  </Card>
);

export default CreatorWorkspaceCard;
