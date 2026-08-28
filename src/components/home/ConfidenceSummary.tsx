import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Progress } from "@/components/ui/progress";
import { ChevronDown, ChevronUp, ShieldCheck } from "lucide-react";
import { useUiPreference } from "@/hooks/useUiPreference";

interface AnalysisSource {
  name: string;
  confidence?: number | null;
  categories?: { name: string; score: number }[];
}

const bandOf = (c: number) =>
  c >= 0.75 ? "high" : c >= 0.5 ? "moderate" : "low";

/**
 * The consumer-facing confidence view: one line of plain language plus an
 * expandable per-source list. The full diagnostic breakdown — per-signal
 * contributions, calibration priors, taxonomy provenance — stays on the admin
 * analysis surface, where the people who tune the pipeline can act on it.
 */
export const ConfidenceSummary = ({ sources }: { sources: AnalysisSource[] }) => {
  const [open, setOpen] = useUiPreference("home.confidence.expanded", false);

  const scored = sources.filter((s) => typeof s.confidence === "number");
  if (!scored.length) return null;

  const values = scored.map((s) => Number(s.confidence));
  const avg = values.reduce((a, b) => a + b, 0) / values.length;
  const weakest = scored.reduce((min, s) =>
    Number(s.confidence) < Number(min.confidence) ? s : min,
  );
  const band = bandOf(avg);

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <Card className="border-border/60 bg-card/70 p-4 backdrop-blur-sm">
        <div className="flex flex-wrap items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-primary" />
          <span className="text-sm font-semibold">How sure is SonicSIM?</span>
          <Badge variant={band === "low" ? "outline" : "secondary"} className="text-[11px]">
            {band} confidence · {(avg * 100).toFixed(0)}%
          </Badge>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm" className="ml-auto h-7 px-2 text-xs">
              {open ? "Hide detail" : "Show detail"}
              {open ? (
                <ChevronUp className="ml-1 h-3.5 w-3.5" />
              ) : (
                <ChevronDown className="ml-1 h-3.5 w-3.5" />
              )}
            </Button>
          </CollapsibleTrigger>
        </div>
        <Progress value={avg * 100} className="mt-3 h-1.5" />
        <p className="mt-2 text-xs text-muted-foreground">
          {band === "high"
            ? "Strong agreement across the signals behind these scores — read them as they are."
            : band === "moderate"
              ? "Reasonable agreement. Adding a few more sources sharpens the picture."
              : `Weak agreement, lowest on “${weakest.name}”. Treat these scores as a first sketch and add more sources.`}
        </p>

        <CollapsibleContent className="mt-3 space-y-1">
          {scored.map((s) => {
            const c = Number(s.confidence);
            return (
              <div
                key={s.name}
                className="flex items-center gap-2 rounded-lg border border-border/50 bg-muted/10 p-2 text-xs"
              >
                <span className="min-w-0 flex-1 truncate">{s.name}</span>
                <div className="h-1.5 w-24 overflow-hidden rounded bg-muted">
                  <div className="h-full bg-primary" style={{ width: `${c * 100}%` }} />
                </div>
                <span className="w-16 text-right text-muted-foreground">
                  {(c * 100).toFixed(0)}% {bandOf(c)}
                </span>
              </div>
            );
          })}
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
};

export default ConfidenceSummary;
