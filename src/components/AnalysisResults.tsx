import { Card } from "@/components/ui/card";
import { Brain } from "lucide-react";
import { cn } from "@/lib/utils";
import { useState } from "react";
import { type MusicalRead } from "@/components/MusicalProfile";
import { useAuth } from "@/hooks/useAuth";
import { useOrganization } from "@/hooks/useOrganization";
import { supabase } from "@/integrations/supabase/client";
import {
  getCategoryStyles,
  getCategoryIcon,
  type CategoryScore,
} from "@/components/analysis/categoryStyles";
import { predictCategory } from "@/components/analysis/predictCategory";
import { SourceResultCard } from "@/components/analysis/SourceResultCard";

interface SourceAnalysis {
  name: string;
  categories: CategoryScore[];
}

interface AnalysisResultsProps {
  results: SourceAnalysis[] | null;
  isAnalyzing: boolean;
  sourceImages?: Array<{ name: string; imageUrl: string }>;
  sourceIds?: Array<{ name: string; id: string }>;
  /** Musical read (pitch/rhythm/timbre) per source, when audio was measured. */
  musical?: MusicalRead[];
}

// Re-exported for backward compatibility with consumers importing these
// helpers from this module.
export { predictCategory, getCategoryStyles, getCategoryIcon };

export const AnalysisResults = ({ results, isAnalyzing, sourceImages = [], sourceIds = [], musical = [] }: AnalysisResultsProps) => {
  // Taxonomy codes, weights and observation counts are operator detail: only
  // admins and enterprise members see them. Consumers get plain language.
  const { isAdmin } = useAuth();
  const { orgs } = useOrganization();
  const showTechnicalDetail = isAdmin || orgs.length > 0;

  // Locally refreshed scores per audio source (after admin feedback submissions)
  const [overrides, setOverrides] = useState<Record<string, CategoryScore[]>>({});
  const [refreshKeys, setRefreshKeys] = useState<Record<string, number>>({});

  const refreshSource = async (audioSourceId: string, fallback: CategoryScore[]) => {
    const { data } = await supabase
      .from("source_analyses")
      .select(
        "emotional_score,cognitive_score,social_score,communication_score,contextual_score,artistic_score,emotional_desc,cognitive_desc,social_desc,communication_desc,contextual_desc,artistic_desc"
      )
      .eq("audio_source_id", audioSourceId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (data) {
      const next: CategoryScore[] = [
        { name: "Emotional", score: Number(data.emotional_score), description: data.emotional_desc ?? "" },
        { name: "Cognitive", score: Number(data.cognitive_score), description: data.cognitive_desc ?? "" },
        { name: "Social", score: Number(data.social_score), description: data.social_desc ?? "" },
        { name: "Communication", score: Number(data.communication_score), description: data.communication_desc ?? "" },
        { name: "Contextual", score: Number(data.contextual_score), description: data.contextual_desc ?? "" },
        { name: "Artistic", score: Number(data.artistic_score), description: data.artistic_desc ?? "" },
      ].map((c, i) => ({ ...c, description: c.description || fallback[i]?.description || "" }));
      setOverrides(s => ({ ...s, [audioSourceId]: next }));
    }
    setRefreshKeys(s => ({ ...s, [audioSourceId]: (s[audioSourceId] ?? 0) + 1 }));
  };

  if (isAnalyzing) {
    return (
      <Card className="p-8 shadow-elegant border-primary/20">
        <div className="space-y-6 text-center">
          <div className="relative flex justify-center">
            <div className="h-20 w-20 animate-spin rounded-full border-4 border-primary/30 border-t-primary"></div>
            <div className="absolute inset-0 flex items-center justify-center">
              <Brain className="h-8 w-8 text-primary animate-pulse" />
            </div>
          </div>
          <div className="space-y-2">
            <p className="text-xl font-semibold text-foreground">Analyzing Semantic Dimensions</p>
            <p className="text-sm text-muted-foreground max-w-md mx-auto">
              Extracting ontological features via hierarchical transformer and aligning multi-modal embeddings
            </p>
          </div>
          <div className="flex justify-center gap-2">
            {["Emotional", "Cognitive", "Social", "Communication", "Contextual", "Artistic"].map((cat, i) => (
              <div
                key={cat}
                className={cn(
                  "h-2 w-2 rounded-full animate-pulse",
                  getCategoryStyles(cat).text.replace("text-", "bg-")
                )}
                style={{ animationDelay: `${i * 0.15}s` }}
              />
            ))}
          </div>
        </div>
      </Card>
    );
  }

  if (!results || results.length === 0) return null;

  const getSourceImage = (sourceName: string) => {
    const match = sourceImages.find(img => img.name === sourceName);
    return match?.imageUrl;
  };

  const getSourceId = (sourceName: string) => {
    const match = sourceIds.find(s => s.name === sourceName);
    return match?.id;
  };

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="text-center space-y-2">
        <h2 className="text-3xl font-bold bg-gradient-to-r from-primary via-secondary to-primary bg-clip-text text-transparent">
          Ontological Analysis
        </h2>
        <p className="text-muted-foreground max-w-xl mx-auto">
          Comparative semantic scoring across six ontological dimensions for each audio source
        </p>
      </div>

      {/* Results grid */}
      <div className="grid gap-8">
        {results.map((source, sourceIndex) => {
          const imageUrl = getSourceImage(source.name);
          const audioSourceId = getSourceId(source.name);
          const categories =
            (audioSourceId ? overrides[audioSourceId] : undefined) ?? source.categories;
          const refreshKey = audioSourceId ? refreshKeys[audioSourceId] ?? 0 : 0;

          return (
            <SourceResultCard
              key={sourceIndex}
              sourceName={source.name}
              sourceIndex={sourceIndex}
              imageUrl={imageUrl}
              audioSourceId={audioSourceId}
              categories={categories}
              refreshKey={refreshKey}
              musical={musical}
              showTechnicalDetail={showTechnicalDetail}
              onRefreshed={(id) =>
                setRefreshKeys((s) => ({ ...s, [id]: (s[id] ?? 0) + 1 }))
              }
              onSubmitted={(id, cats) => refreshSource(id, cats)}
            />
          );
        })}
      </div>

      {/* Add animation keyframes */}
      <style>{`
        @keyframes slideIn {
          from { width: 0; }
          to { width: var(--target-width); }
        }
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes scale-in {
          from { transform: scale(0); opacity: 0; }
          to { transform: scale(1); opacity: 1; }
        }
      `}</style>
    </div>
  );
};
