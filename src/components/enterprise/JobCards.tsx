import { LineChart, Tag, Target } from "lucide-react";
import { Card } from "@/components/ui/card";

/**
 * Step 16b — the workspace landing is three jobs, not a widget wall. Each card
 * opens the panel that does that job, with its input already in view.
 */
const JOBS = [
  {
    tab: "users",
    label: "Find an audience",
    blurb: "Describe who you want in a sentence; get a sonic profile you can refine.",
    icon: Target,
    gradient: "var(--gradient-cognitive)",
  },
  {
    tab: "outcomes",
    label: "Predict performance",
    blurb: "Score creative against outcomes your own data has seen.",
    icon: LineChart,
    gradient: "var(--gradient-social)",
  },
  {
    tab: "tags",
    label: "Activate a segment",
    blurb: "Push a cohort to your pixel and trading desk.",
    icon: Tag,
    gradient: "var(--gradient-artistic)",
  },
] as const;

export const JobCards = ({ onPick }: { onPick: (tab: string) => void }) => (
  <div className="grid gap-3 sm:grid-cols-3">
    {JOBS.map((j) => (
      <button key={j.tab} type="button" onClick={() => onPick(j.tab)} className="text-left">
        <Card className="relative h-full overflow-hidden border-border/60 bg-card/70 p-4 backdrop-blur-sm transition-smooth hover:shadow-elegant">
          <span
            aria-hidden
            className="absolute inset-x-0 top-0 h-1"
            style={{ background: j.gradient }}
          />
          <span className="mb-2 inline-flex rounded-lg bg-primary/10 p-2 text-primary">
            <j.icon className="h-4 w-4" />
          </span>
          <p className="text-sm font-semibold text-foreground">{j.label}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">{j.blurb}</p>
        </Card>
      </button>
    ))}
  </div>
);

export default JobCards;
