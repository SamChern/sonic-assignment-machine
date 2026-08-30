/**
 * The consumer ladder's one upsell: the two sonic cohorts closest to the
 * result the visitor just made. The pitch is their own data, not a brochure.
 */
import { Link } from "react-router-dom";
import { Users } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { UserFingerprint } from "@/hooks/useFingerprints";

export interface CohortMatch {
  fp: UserFingerprint;
  similarity: number;
}

export const CohortUpsellCard = ({ cohorts }: { cohorts: CohortMatch[] }) => {
  if (cohorts.length === 0) return null;

  return (
    <Card className="border-primary/25 bg-primary/5 p-4 sm:p-6">
      <div className="flex items-center gap-2">
        <Users className="h-4 w-4 text-primary" />
        <h3 className="font-semibold text-foreground">That was one piece of audio</h3>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        Businesses run this across 10,000 audience signals. Here are the two sonic cohorts
        closest to what you just made.
      </p>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {cohorts.map(({ fp, similarity }) => (
          <div
            key={fp.user_id}
            className="rounded-lg border border-border bg-card/60 p-3 text-sm"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="truncate font-medium text-foreground">
                {(fp as never as { username?: string }).username || "Cohort"}
              </span>
              <Badge variant="secondary" className="tabular-nums text-xs">
                {Math.round(similarity * 100)}% match
              </Badge>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {fp.total_sources_analyzed} sources in this cohort's fingerprint
            </p>
          </div>
        ))}
      </div>
      <Button asChild size="sm" className="mt-4 gradient-primary">
        <Link to="/workspace">See what this does at scale</Link>
      </Button>
    </Card>
  );
};

export default CohortUpsellCard;
