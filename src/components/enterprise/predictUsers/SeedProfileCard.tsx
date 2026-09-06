import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Sparkles, Wand2, X } from "lucide-react";
import type { SeedTag } from "./types";

interface SeedProfileCardProps {
  brief: string;
  setBrief: (value: string) => void;
  proposeFromBrief: () => void;
  seeding: boolean;
  seedIds: string[];
  seedFromRecords: () => void;
  useDatasetAverage: () => void;
  datasetId: string;
  tags: SeedTag[];
  dropTag: (id: string) => void;
}

/** 11a — the audience brief and exemplar-seeding controls. */
const SeedProfileCard = ({
  brief,
  setBrief,
  proposeFromBrief,
  seeding,
  seedIds,
  seedFromRecords,
  useDatasetAverage,
  datasetId,
  tags,
  dropTag,
}: SeedProfileCardProps) => {
  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Wand2 className="h-4 w-4 text-primary" />
        <h2 className="text-sm font-semibold">Describe your audience</h2>
        <Badge variant="outline" className="text-[11px]">evidence-seeded</Badge>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        Write the brief in your own words. SonicSIM embeds it into the same space as every scored
        audio profile and proposes a six-axis target plus the taxonomy tags that contributed —
        the sliders below then refine that proposal instead of guessing it.
      </p>
      <Textarea
        value={brief}
        onChange={(e) => setBrief(e.target.value)}
        rows={3}
        className="mt-3 text-xs"
        placeholder="e.g. late-night true-crime listeners who take morning fitness classes"
      />
      <div className="mt-2 flex flex-wrap gap-2">
        <Button size="sm" onClick={proposeFromBrief} disabled={seeding || brief.trim().length < 8}>
          {seeding ? (
            <Loader2 className="mr-1 h-4 w-4 animate-spin" />
          ) : (
            <Sparkles className="mr-1 h-4 w-4" />
          )}
          Propose profile
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={seedFromRecords}
          disabled={seeding || seedIds.length < 3}
        >
          Use {seedIds.length || 0} selected records as seed
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={useDatasetAverage}
          disabled={datasetId === "all"}
        >
          Use dataset average
        </Button>
      </div>

      {tags.length > 0 && (
        <div className="mt-3">
          <p className="text-[11px] font-medium text-muted-foreground">
            Top contributing taxonomy tags — remove any that do not belong
          </p>
          <div className="mt-2 flex flex-wrap gap-1">
            {tags.map((t) => (
              <Badge key={t.id} variant="secondary" className="gap-1 text-[11px]">
                {t.label}
                <span className="text-muted-foreground">{(t.similarity * 100).toFixed(0)}%</span>
                <button
                  type="button"
                  aria-label={`Remove ${t.label}`}
                  onClick={() => dropTag(t.id)}
                  className="ml-1 rounded-sm hover:text-destructive"
                >
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
};

export default SeedProfileCard;
