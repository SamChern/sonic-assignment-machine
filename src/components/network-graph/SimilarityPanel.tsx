import { useState } from "react";
import type { SimilarityMetrics } from "./types";

interface SimilarityPanelProps {
  similarityMetrics: SimilarityMetrics;
  /** Whether the source set has more than one entry (details are multi-source only). */
  isMultiSource: boolean;
}

/** Bottom-left overall/category/source-pair similarity breakdown panel. */
export const SimilarityPanel = ({ similarityMetrics, isMultiSource }: SimilarityPanelProps) => {
  const [showDetails, setShowDetails] = useState(false);

  return (
    <div className="absolute bottom-4 left-4 bg-card/95 backdrop-blur-md border border-primary/20 rounded-lg p-4 shadow-lg z-20 max-w-[400px]">
      <div className="flex items-center justify-between mb-3">
        <div className="text-xs font-semibold text-foreground">SonicSIM.ai Similarity</div>
        {isMultiSource && (
          <button
            onClick={() => setShowDetails(!showDetails)}
            className="text-[10px] text-primary hover:text-primary/80 transition-colors px-2 py-1 bg-primary/10 rounded"
          >
            {showDetails ? 'Hide Details' : 'View Details'}
          </button>
        )}
      </div>

      <div className="relative h-6 rounded-full overflow-hidden border border-border/30 mb-2">
        <div
          className="h-full rounded-full transition-all duration-1000 ease-out"
          style={{
            width: `${similarityMetrics.overall}%`,
            background: similarityMetrics.overall > 75
              ? "linear-gradient(90deg, hsl(160, 75%, 50%), hsl(140, 70%, 55%))"
              : similarityMetrics.overall > 50
              ? "linear-gradient(90deg, hsl(180, 80%, 60%), hsl(160, 75%, 50%))"
              : "linear-gradient(90deg, hsl(200, 85%, 55%), hsl(180, 80%, 60%))",
          }}
        />
      </div>
      <div className="text-center mb-2">
        <div className="text-2xl font-bold text-foreground">{similarityMetrics.overall}%</div>
        <div className="text-[10px] text-muted-foreground">
          {similarityMetrics.overall > 75
            ? "Cohesive identity cluster - high brand consistency"
            : similarityMetrics.overall > 50
            ? "Balanced mix - complementary with distinctiveness"
            : "Diverse semantic profiles - great for range analysis"}
        </div>
      </div>

      {showDetails && isMultiSource && (
        <div className="mt-4 pt-4 border-t border-border/30 space-y-3 max-h-[300px] overflow-y-auto">
          <div>
            <div className="text-[10px] font-semibold text-foreground mb-2">Category Alignment</div>
            <div className="space-y-1.5">
              {similarityMetrics.byCategory
                .sort((a, b) => b.similarity - a.similarity)
                .map((cat) => (
                  <div key={cat.name} className="space-y-1">
                    <div className="flex items-center justify-between text-[9px]">
                      <span className="text-foreground/80">{cat.name}</span>
                      <span className={`font-medium ${
                        cat.interpretation === 'high' ? 'text-green-400' :
                        cat.interpretation === 'moderate' ? 'text-yellow-400' :
                        'text-red-400'
                      }`}>
                        {Math.round(cat.similarity * 100)}%
                      </span>
                    </div>
                    <div className="h-1.5 bg-border/30 rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all"
                        style={{
                          width: `${cat.similarity * 100}%`,
                          backgroundColor:
                            cat.interpretation === 'high' ? 'hsl(160, 75%, 50%)' :
                            cat.interpretation === 'moderate' ? 'hsl(180, 80%, 60%)' :
                            'hsl(200, 85%, 55%)',
                        }}
                      />
                    </div>
                  </div>
                ))}
            </div>
          </div>

          {similarityMetrics.sourcePairs.length > 0 && (
            <div>
              <div className="text-[10px] font-semibold text-foreground mb-2">Source Pair Comparisons</div>
              <div className="space-y-1">
                {similarityMetrics.sourcePairs.slice(0, 3).map((pair, idx) => (
                  <div key={idx} className="text-[9px] flex items-center justify-between text-foreground/70">
                    <span className="truncate flex-1">{pair.source1} ↔ {pair.source2}</span>
                    <span className="ml-2 font-medium">{Math.round(pair.similarity * 100)}%</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {(similarityMetrics.dominantCategory || similarityMetrics.distinctiveCategory) && (
            <div>
              <div className="text-[10px] font-semibold text-foreground mb-2">Key Insights</div>
              <div className="space-y-1 text-[9px] text-foreground/70">
                {similarityMetrics.dominantCategory && (
                  <div className="flex items-start gap-1">
                    <span className="text-green-400">●</span>
                    <span>Most unified: <span className="font-medium text-foreground">{similarityMetrics.dominantCategory}</span></span>
                  </div>
                )}
                {similarityMetrics.distinctiveCategory && (
                  <div className="flex items-start gap-1">
                    <span className="text-red-400">●</span>
                    <span>Most distinctive: <span className="font-medium text-foreground">{similarityMetrics.distinctiveCategory}</span></span>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
