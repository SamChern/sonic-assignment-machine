import { Card } from "@/components/ui/card";
import { Music } from "lucide-react";
import { cn } from "@/lib/utils";
import { lazy, Suspense } from "react";
const VisualsFallback = () => (
  <div className="h-24 animate-pulse rounded-md bg-secondary/30" />
);
import { FeedbackPopover } from "@/components/FeedbackPopover";
import { AudioSignalRefresh } from "@/components/admin/AudioSignalRefresh";
import { MusicalProfile, type MusicalRead } from "@/components/MusicalProfile";
import { GroundingBadge } from "@/components/GroundingBadge";
import {
  AcousticVisualsToggle,
  HarmonicPreview,
  NeighborContext,
} from "@/components/analysis/SourceDetailPanels";
import { IntuiziTagMapping } from "@/components/analysis/IntuiziTagMapping";
import { getCategoryStyles, getCategoryIcon, type CategoryScore } from "@/components/analysis/categoryStyles";
import { RadialScoreChart, AnimatedScoreBar } from "@/components/analysis/ScoreCharts";
import { predictCategory } from "@/components/analysis/predictCategory";

const SignatureCard = lazy(() =>
  import("@/components/SignatureCard").then((m) => ({ default: m.SignatureCard }))
);

interface SourceResultCardProps {
  sourceName: string;
  sourceIndex: number;
  imageUrl?: string;
  audioSourceId?: string;
  categories: CategoryScore[];
  refreshKey: number;
  musical: MusicalRead[];
  showTechnicalDetail: boolean;
  onRefreshed: (audioSourceId: string) => void;
  onSubmitted: (audioSourceId: string, categories: CategoryScore[]) => void;
}

export const SourceResultCard = ({
  sourceName,
  sourceIndex,
  imageUrl,
  audioSourceId,
  categories,
  refreshKey,
  musical,
  showTechnicalDetail,
  onRefreshed,
  onSubmitted,
}: SourceResultCardProps) => {
  return (
    <Card
      className="p-6 shadow-elegant border-border/50 hover:border-primary/30 transition-all duration-300 overflow-hidden"
      style={{ animationDelay: `${sourceIndex * 0.15}s` }}
    >
      <div className="flex flex-col lg:flex-row gap-6">
        {/* Left side: Source info + radial chart */}
        <div className="flex flex-col items-center gap-4 lg:w-64 shrink-0">
          {/* Album art or placeholder */}
          {imageUrl ? (
            <div className="relative group">
              <img
                src={imageUrl}
                alt={sourceName}
                className="w-24 h-24 rounded-lg object-cover shadow-lg group-hover:shadow-glow transition-all duration-300"
              />
              <div className="absolute inset-0 rounded-lg bg-gradient-to-t from-background/80 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
            </div>
          ) : (
            <div className="w-24 h-24 rounded-lg bg-muted flex items-center justify-center">
              <Music className="h-10 w-10 text-muted-foreground" />
            </div>
          )}
          
          <div className="text-center">
            <h3 className="text-lg font-bold text-foreground line-clamp-2">{sourceName}</h3>
            <span className="text-xs text-primary/70 font-medium">Ontological Fingerprint</span>
          </div>

          {/* Predicted categorical ontology label */}
          {(() => {
            const top = predictCategory(categories);
            if (!top) return null;
            const styles = getCategoryStyles(top.name);
            return (
              <div
                className={cn(
                  "flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold transition-all",
                  styles.bg,
                  styles.border,
                  styles.text
                )}
                title={`Predicted human-relation category (top of 6 dimensions): ${top.name} · ${top.score}`}
              >
                <span>{getCategoryIcon(top.name)}</span>
                <span className="uppercase tracking-wide">{top.name}</span>
                <span className="opacity-70 tabular-nums">{top.score}</span>
              </div>
            );
          })()}

          {/* Step 14b — how this score knew what it knew */}
          {audioSourceId && <GroundingBadge audioSourceId={audioSourceId} />}

          {/* Audio Signal Refresh — admin-only open-web enrichment */}
          {audioSourceId && (
            <AudioSignalRefresh
              audioSourceId={audioSourceId}
              sourceName={sourceName}
              onRefreshed={() => onRefreshed(audioSourceId)}
            />
          )}

          {/* Musical read — only for sources with measured audio */}
          {(() => {
            const read = musical.find((m) => m.name === sourceName);
            return read ? <MusicalProfile read={read} /> : null;
          })()}

          {/* Radial chart */}

          <RadialScoreChart key={`radial-${refreshKey}`} categories={categories} />

          {audioSourceId && (
            <FeedbackPopover
              audioSourceId={audioSourceId}
              currentScores={Object.fromEntries(
                categories.map(c => [c.name.toLowerCase(), c.score])
              )}
              onSubmitted={() => onSubmitted(audioSourceId, categories)}
            />
          )}

          {/* Step 15 — the sound of this fingerprint, plus its Ensemble archetype */}
          <Suspense fallback={<VisualsFallback />}>
            <SignatureCard
              className="w-full"
              compact
              subjectRef={sourceName}
              vector={Object.fromEntries(
                categories.map(c => [c.name.toLowerCase(), c.score])
              ) as never}
            />
          </Suspense>
        </div>


        {/* Right side: Category cards */}
        <div className="flex-1 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {categories.map((category, catIndex) => {
            const styles = getCategoryStyles(category.name);
            
            return (
              <div
                key={catIndex}
                className={cn(
                  "group relative rounded-xl border p-4 transition-all duration-300",
                  styles.border,
                  styles.glow
                )}
                style={{ 
                  animationDelay: `${(sourceIndex * 0.1) + (catIndex * 0.05)}s`,
                  animation: "fadeIn 0.5s ease-out both"
                }}
              >
                {/* Category header */}
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <div className={cn(
                      "flex h-8 w-8 items-center justify-center rounded-lg transition-all duration-300",
                      styles.bg,
                      "group-hover:scale-110"
                    )}>
                      <span className={styles.text}>
                        {getCategoryIcon(category.name)}
                      </span>
                    </div>
                    <h4 className={cn("font-semibold text-sm", styles.text)}>
                      {category.name}
                    </h4>
                  </div>
                  <span className={cn(
                    "text-2xl font-bold tabular-nums",
                    styles.text
                  )}>
                    {category.score}
                  </span>
                </div>

                {/* Score bar */}
                <AnimatedScoreBar 
                  score={category.score} 
                  categoryName={category.name}
                  delay={(sourceIndex * 0.1) + (catIndex * 0.05)}
                />

                {/* Description */}
                <p className="mt-3 text-xs text-muted-foreground leading-relaxed line-clamp-3">
                  {category.description}
                </p>
              </div>
            );
          })}
        </div>
      </div>
      {audioSourceId && (
        <IntuiziTagMapping
          audioSourceId={audioSourceId}
          refreshKey={refreshKey}
          technical={showTechnicalDetail}
          scores={Object.fromEntries(
            categories.map((c) => [c.name.toLowerCase(), c.score]),
          )}
        />
      )}

      {audioSourceId && (
        <NeighborContext audioSourceId={audioSourceId} refreshKey={refreshKey} />
      )}
      {audioSourceId && <HarmonicPreview audioSourceId={audioSourceId} />}
      {audioSourceId && <AcousticVisualsToggle audioSourceId={audioSourceId} />}
    </Card>
  );
};
