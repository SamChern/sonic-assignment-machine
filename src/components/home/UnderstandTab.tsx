import { lazy, Suspense } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  AnalysisResults,
  predictCategory,
  getCategoryStyles,
  getCategoryIcon,
} from "@/components/AnalysisResults";
import SourceFilterBar from "@/components/home/SourceFilterBar";
import ConfidenceSummary from "@/components/home/ConfidenceSummary";
import { cn } from "@/lib/utils";
import { Network } from "lucide-react";

const SemanticGraphView = lazy(() =>
  import("@/components/NetworkVisualization").then((m) => ({ default: m.NetworkVisualization })),
);

const CATEGORIES = [
  "Emotional",
  "Cognitive",
  "Social",
  "Communication",
  "Contextual",
  "Artistic",
] as const;

/**
 * Understand — the ontology network and the per-source read of it, on one screen.
 * Splitting them across two tabs made users flip back and forth to answer a
 * single question: what is this sound doing, and to whom.
 */
export const UnderstandTab = ({
  results,
  selectedSources,
  selectedCategories,
  highlightSourceName,
  onToggleSource,
  onClearSources,
  onToggleCategory,
  onClearCategories,
}: {
  results: { sources: any[]; images: any[] } | null;
  selectedSources: string[];
  selectedCategories: string[];
  highlightSourceName: string | null;
  onToggleSource: (name: string) => void;
  onClearSources: () => void;
  onToggleCategory: (category: string) => void;
  onClearCategories: () => void;
}) => {
  if (!results || results.sources.length === 0) {
    return (
      <Card className="flex flex-col items-center gap-3 border-dashed border-border/60 bg-card/50 p-10 text-center">
        <Network className="h-8 w-8 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">
          Analyze a source in <span className="font-medium text-foreground">Listen</span> and its
          ontology network appears here.
        </p>
      </Card>
    );
  }

  const sourceNames: string[] = results.sources.map((s: any) => s.name);
  const matchesSelection = (name: string) =>
    selectedSources.length === 0 ||
    selectedSources.some((selected) => selected.trim() === name.trim());

  const bySource = results.sources.filter((s: any) => matchesSelection(s.name));
  const images = results.images.filter((img: any) => matchesSelection(img.name));
  const scoped =
    selectedCategories.length === 0
      ? bySource
      : bySource.filter((source: any) => {
          const top = predictCategory(source.categories);
          return top ? selectedCategories.includes(top.name) : false;
        });

  return (
    <div className="space-y-6">
      <SourceFilterBar
        sourceNames={sourceNames}
        selected={selectedSources}
        onToggle={onToggleSource}
        onClear={onClearSources}
      />

      <Suspense
        fallback={
          <div className="flex h-[400px] items-center justify-center">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
          </div>
        }
      >
        <SemanticGraphView
          sources={bySource}
          sourceImages={images}
          highlightSourceName={highlightSourceName}
        />
      </Suspense>

      <ConfidenceSummary sources={results.sources} />

      <div className="flex flex-wrap items-center gap-2">
        <span className="mr-1 text-sm font-semibold text-foreground">Filter:</span>
        {CATEGORIES.map((cat) => {
          const styles = getCategoryStyles(cat);
          const active = selectedCategories.includes(cat);
          return (
            <button
              key={cat}
              onClick={() => onToggleCategory(cat)}
              aria-pressed={active}
              className={cn(
                "flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition-all duration-200",
                active
                  ? [styles.bg, styles.border, styles.text, "shadow-sm"].join(" ")
                  : "border-border/50 bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              {getCategoryIcon(cat)}
              <span>{cat}</span>
            </button>
          );
        })}
        {selectedCategories.length > 0 && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onClearCategories}
            className="h-7 px-2 text-xs"
          >
            Clear
          </Button>
        )}
      </div>

      <AnalysisResults results={scoped} isAnalyzing={false} sourceImages={images} />
    </div>
  );
};

export default UnderstandTab;
