import { Card } from "@/components/ui/card";
import { Brain, Users, Heart, MessageSquare, Music, MapPin, Waves } from "lucide-react";
import { cn } from "@/lib/utils";
import { useEffect, useState, lazy, Suspense } from "react";
import { Button } from "@/components/ui/button";
const LibrosaVisuals = lazy(() =>
  import("@/components/visuals/LibrosaVisuals").then((m) => ({ default: m.LibrosaVisuals }))
);
const ChromaTonnetzPanel = lazy(() =>
  import("@/components/visuals/LibrosaVisuals").then((m) => ({ default: m.ChromaTonnetzPanel }))
);
const VisualsFallback = () => (
  <div className="h-24 animate-pulse rounded-md bg-secondary/30" />
);
import { useStoredLibrosaFeatures } from "@/hooks/useLibrosaFeatures";
import { FeedbackPopover } from "@/components/FeedbackPopover";
import { supabase } from "@/integrations/supabase/client";

interface CategoryScore {
  name: string;
  score: number;
  description: string;
}

interface SourceAnalysis {
  name: string;
  categories: CategoryScore[];
}

// Predict the dominant ontological category (argmax of the 6 scores).
// This is the post-hoc categorical label expressing how the audio relates
// to humans most strongly.
export const predictCategory = (categories: CategoryScore[]): CategoryScore | null => {
  if (!categories || categories.length === 0) return null;
  return categories.reduce((best, cur) => (cur.score > best.score ? cur : best));
};

interface AnalysisResultsProps {
  results: SourceAnalysis[] | null;
  isAnalyzing: boolean;
  sourceImages?: Array<{ name: string; imageUrl: string }>;
  sourceIds?: Array<{ name: string; id: string }>;
}

// Category color mapping
const categoryColors: Record<string, { bg: string; border: string; text: string; glow: string }> = {
  emotional: {
    bg: "bg-category-emotional/10",
    border: "border-category-emotional/30 hover:border-category-emotional/60",
    text: "text-category-emotional",
    glow: "hover:shadow-[0_0_30px_hsl(220_90%_56%/0.3)]",
  },
  cognitive: {
    bg: "bg-category-cognitive/10",
    border: "border-category-cognitive/30 hover:border-category-cognitive/60",
    text: "text-category-cognitive",
    glow: "hover:shadow-[0_0_30px_hsl(142_70%_45%/0.3)]",
  },
  social: {
    bg: "bg-category-social/10",
    border: "border-category-social/30 hover:border-category-social/60",
    text: "text-category-social",
    glow: "hover:shadow-[0_0_30px_hsl(174_72%_40%/0.3)]",
  },
  communication: {
    bg: "bg-category-communication/10",
    border: "border-category-communication/30 hover:border-category-communication/60",
    text: "text-category-communication",
    glow: "hover:shadow-[0_0_30px_hsl(84_80%_44%/0.3)]",
  },
  contextual: {
    bg: "bg-category-contextual/10",
    border: "border-category-contextual/30 hover:border-category-contextual/60",
    text: "text-category-contextual",
    glow: "hover:shadow-[0_0_30px_hsl(200_90%_50%/0.3)]",
  },
  artistic: {
    bg: "bg-category-artistic/10",
    border: "border-category-artistic/30 hover:border-category-artistic/60",
    text: "text-category-artistic",
    glow: "hover:shadow-[0_0_30px_hsl(168_76%_42%/0.3)]",
  },
};

export const getCategoryStyles = (categoryName: string) => {
  return categoryColors[categoryName.toLowerCase()] || categoryColors.emotional;
};

// Radial score visualization component
const RadialScoreChart = ({ categories }: { categories: CategoryScore[] }) => {
  const size = 180;
  const center = size / 2;
  const maxRadius = 70;
  const minRadius = 20;

  const angleStep = (2 * Math.PI) / categories.length;

  const points = categories.map((cat, i) => {
    const angle = i * angleStep - Math.PI / 2;
    const radius = minRadius + (cat.score / 100) * (maxRadius - minRadius);
    return {
      x: center + radius * Math.cos(angle),
      y: center + radius * Math.sin(angle),
      score: cat.score,
      name: cat.name,
    };
  });

  const pathD = points
    .map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`)
    .join(" ") + " Z";

  return (
    <svg width={size} height={size} className="drop-shadow-lg">
      {/* Background circles */}
      {[25, 50, 75, 100].map((pct) => (
        <circle
          key={pct}
          cx={center}
          cy={center}
          r={minRadius + (pct / 100) * (maxRadius - minRadius)}
          fill="none"
          stroke="hsl(var(--border))"
          strokeWidth="1"
          opacity="0.3"
        />
      ))}
      
      {/* Axis lines */}
      {categories.map((_, i) => {
        const angle = i * angleStep - Math.PI / 2;
        return (
          <line
            key={i}
            x1={center}
            y1={center}
            x2={center + maxRadius * Math.cos(angle)}
            y2={center + maxRadius * Math.sin(angle)}
            stroke="hsl(var(--border))"
            strokeWidth="1"
            opacity="0.3"
          />
        );
      })}

      {/* Score polygon */}
      <path
        d={pathD}
        fill="hsl(var(--primary) / 0.2)"
        stroke="hsl(var(--primary))"
        strokeWidth="2"
        className="animate-[scale-in_0.5s_ease-out]"
      />

      {/* Score points */}
      {points.map((p, i) => (
        <circle
          key={i}
          cx={p.x}
          cy={p.y}
          r="4"
          fill="hsl(var(--primary))"
          className="animate-[scale-in_0.3s_ease-out]"
          style={{ animationDelay: `${i * 0.1}s` }}
        />
      ))}

      {/* Category labels */}
      {categories.map((cat, i) => {
        const angle = i * angleStep - Math.PI / 2;
        const labelRadius = maxRadius + 18;
        const x = center + labelRadius * Math.cos(angle);
        const y = center + labelRadius * Math.sin(angle);
        const styles = getCategoryStyles(cat.name);
        
        return (
          <text
            key={i}
            x={x}
            y={y}
            textAnchor="middle"
            dominantBaseline="middle"
            className={cn("text-[10px] font-medium fill-current", styles.text)}
          >
            {cat.name.slice(0, 4)}
          </text>
        );
      })}
    </svg>
  );
};

// Animated score bar component
const AnimatedScoreBar = ({ score, categoryName, delay }: { score: number; categoryName: string; delay: number }) => {
  const styles = getCategoryStyles(categoryName);
  
  return (
    <div className="relative h-2 w-full overflow-hidden rounded-full bg-muted">
      <div
        className={cn(
          "absolute left-0 top-0 h-full rounded-full transition-all duration-1000 ease-out",
          styles.text.replace("text-", "bg-")
        )}
        style={{
          width: `${score}%`,
          animation: `slideIn 0.8s ease-out ${delay}s both`,
        }}
      />
    </div>
  );
};

export const AnalysisResults = ({ results, isAnalyzing, sourceImages = [], sourceIds = [] }: AnalysisResultsProps) => {
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
            <Card
              key={sourceIndex}
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
                        alt={source.name}
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
                    <h3 className="text-lg font-bold text-foreground line-clamp-2">{source.name}</h3>
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

                  {/* Radial chart */}

                  <RadialScoreChart key={`radial-${refreshKey}`} categories={categories} />

                  {audioSourceId && (
                    <FeedbackPopover
                      audioSourceId={audioSourceId}
                      currentScores={Object.fromEntries(
                        categories.map(c => [c.name.toLowerCase(), c.score])
                      )}
                      onSubmitted={() => refreshSource(audioSourceId, categories)}
                    />
                  )}
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
                <NeighborContext audioSourceId={audioSourceId} refreshKey={refreshKey} />
              )}
              {audioSourceId && <HarmonicPreview audioSourceId={audioSourceId} />}
              {audioSourceId && <AcousticVisualsToggle audioSourceId={audioSourceId} />}
            </Card>
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

// Icon mapping helper
export const getCategoryIcon = (categoryName: string) => {
  const iconMap: Record<string, React.ReactNode> = {
    emotional: <Heart className="h-4 w-4" />,
    cognitive: <Brain className="h-4 w-4" />,
    social: <Users className="h-4 w-4" />,
    communication: <MessageSquare className="h-4 w-4" />,
    contextual: <MapPin className="h-4 w-4" />,
    artistic: <Music className="h-4 w-4" />,
  };
  
  return iconMap[categoryName.toLowerCase()] || <Brain className="h-4 w-4" />;
};

// Collapsible "Acoustic visuals" panel rendered under each analyzed source.
// Only fetches the cached librosa_features blob when the user opens it.
function AcousticVisualsToggle({ audioSourceId }: { audioSourceId: string }) {
  const [open, setOpen] = useState(false);
  const { features, loading, status } = useStoredLibrosaFeatures(open ? audioSourceId : null);

  const statusLabel =
    status === "queued"
      ? "Queued for analysis…"
      : status === "processing"
        ? "Analyzing audio…"
        : status === "failed"
          ? "Analysis failed for this source."
          : null;

  return (
    <div className="mt-6 border-t border-border/50 pt-4">
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setOpen(o => !o)}
        className="text-muted-foreground hover:text-foreground"
      >
        <Waves className="h-4 w-4 mr-2" />
        {open ? "Hide acoustic visuals" : "Show acoustic visuals"}
      </Button>
      {open && (
        <div className="mt-3">
          {loading && <p className="text-xs text-muted-foreground">Loading…</p>}
          {!loading && !features && statusLabel && (
            <p
              className={`text-xs ${
                status === "failed" ? "text-destructive" : "text-muted-foreground"
              }`}
            >
              {statusLabel}
            </p>
          )}
          {!loading && !features && !statusLabel && (
            <p className="text-xs text-muted-foreground">
              No acoustic features cached for this source yet.
            </p>
          )}
          {features && <LibrosaVisuals features={features} />}

        </div>
      )}
    </div>
  );
}

// Always-visible chroma heatmap + tonnetz preview rendered under each source.
// Silently no-ops if the source has no cached librosa_features yet.
function HarmonicPreview({ audioSourceId }: { audioSourceId: string }) {
  const { features } = useStoredLibrosaFeatures(audioSourceId);
  if (!features) return null;
  return (
    <div className="mt-6 border-t border-border/50 pt-4">
      <div className="flex items-center gap-2 mb-3">
        <Waves className="h-4 w-4 text-primary" />
        <h4 className="text-sm font-semibold">Harmonic preview</h4>
        <span className="text-xs text-muted-foreground">
          chroma · tonnetz
        </span>
      </div>
      <ChromaTonnetzPanel features={features} />
    </div>
  );
}

// Nearest-neighbor context for a source: re-queried whenever refreshKey changes
// (e.g. after admin feedback is submitted and calibration re-runs).
function NeighborContext({ audioSourceId, refreshKey }: { audioSourceId: string; refreshKey: number }) {
  const [rows, setRows] = useState<any[] | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data: src } = await supabase
        .from("audio_sources")
        .select("profile_embedding")
        .eq("id", audioSourceId)
        .maybeSingle();
      const emb = (src as any)?.profile_embedding;
      if (!emb) {
        if (!cancelled) { setRows(null); setLoading(false); }
        return;
      }
      const { data } = await supabase.rpc("match_audio_profiles", {
        query_embedding: emb,
        match_count: 5,
        exclude_id: audioSourceId,
      });
      if (!cancelled) {
        setRows((data as any[]) ?? []);
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [audioSourceId, refreshKey]);

  if (!loading && (!rows || rows.length === 0)) return null;

  return (
    <div className="mt-6 border-t border-border/50 pt-4">
      <h4 className="text-sm font-semibold mb-2">Neighbor context</h4>
      {loading ? (
        <p className="text-xs text-muted-foreground">Refreshing neighbors…</p>
      ) : (
        <div className="space-y-1">
          {rows!.map((n) => (
            <div key={n.id} className="flex items-center gap-3 text-xs">
              <span className="flex-1 truncate">{n.name}</span>
              <span className="tabular-nums text-muted-foreground">
                {(Number(n.similarity) * 100).toFixed(0)}%
              </span>
              <span className="tabular-nums text-muted-foreground hidden sm:inline">
                {[n.emotional_score, n.cognitive_score, n.social_score, n.communication_score, n.contextual_score, n.artistic_score]
                  .map((s) => Math.round(Number(s)))
                  .join(" · ")}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
