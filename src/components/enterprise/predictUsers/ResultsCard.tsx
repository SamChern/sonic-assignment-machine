import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { Users } from "lucide-react";
import type { KnnMatch, RecordRow } from "./types";

interface LocalMatch {
  record: RecordRow;
  score: number;
}

interface ResultsCardProps {
  loading: boolean;
  reweighted: KnnMatch[] | null;
  atThreshold: KnnMatch[];
  localMatches: LocalMatch[];
  seedIds: string[];
  toggleSeed: (id: string) => void;
}

/** Ranked results — kNN neighbours once retrieved, otherwise the local six-axis fallback. */
const ResultsCard = ({
  loading,
  reweighted,
  atThreshold,
  localMatches,
  seedIds,
  toggleSeed,
}: ResultsCardProps) => {
  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Users className="h-4 w-4 text-primary" />
        <h3 className="text-sm font-semibold">
          {reweighted ? "Nearest profiles in the shared space" : "Closest records by six axes"}
        </h3>
        {reweighted && (
          <Badge variant="outline" className="text-[11px]">
            ranked by kNN, re-weighted by your sliders
          </Badge>
        )}
      </div>

      {loading ? (
        <Skeleton className="mt-3 h-40 w-full" />
      ) : reweighted ? (
        <div className="mt-3 space-y-1">
          {atThreshold.slice(0, 25).map((m, i) => (
            <div
              key={m.key}
              className="flex flex-wrap items-center gap-2 rounded-lg border border-border/50 bg-muted/10 p-2 text-xs"
            >
              <span className="w-6 text-muted-foreground">{i + 1}</span>
              <span className="min-w-0 flex-1 truncate">{m.label}</span>
              <span className="text-primary">sim {(m.knn_similarity * 100).toFixed(0)}%</span>
              <span className="text-muted-foreground">axes {(m.axis_fit * 100).toFixed(0)}%</span>
            </div>
          ))}
          {!atThreshold.length && (
            <p className="text-xs text-muted-foreground">
              Nothing clears this similarity floor — lower it to trade resonance for reach.
            </p>
          )}
        </div>
      ) : (
        <div className="mt-3 space-y-1">
          {localMatches.slice(0, 25).map((m, i) => (
            <label
              key={m.record.id}
              className="flex flex-wrap items-center gap-2 rounded-lg border border-border/50 bg-muted/10 p-2 text-xs"
            >
              <span className="w-6 text-muted-foreground">{i + 1}</span>
              <Checkbox
                checked={seedIds.includes(m.record.id)}
                onCheckedChange={() => toggleSeed(m.record.id)}
                aria-label="Use as seed exemplar"
              />
              <span className="min-w-0 flex-1 truncate">
                {m.record.external_user_id ?? m.record.source_name ?? m.record.id.slice(0, 8)}
              </span>
              <span className="text-primary">{(m.score * 100).toFixed(0)}%</span>
            </label>
          ))}
          {!localMatches.length && (
            <p className="text-xs text-muted-foreground">
              No scored records yet — upload or sync data in My data first.
            </p>
          )}
        </div>
      )}
    </Card>
  );
};

export default ResultsCard;
