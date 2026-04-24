import { useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Heart, Brain, Users, MessageCircle, Map, Palette, User, X, GitCompare } from "lucide-react";
import {
  calculateSimilarity as sharedSimilarity,
  type FingerprintMode,
} from "@/lib/fingerprintMath";

interface UserFingerprint {
  user_id: string;
  username?: string | null;
  avatar_url?: string | null;
  emotional_avg: number;
  cognitive_avg: number;
  social_avg: number;
  communication_avg: number;
  contextual_avg: number;
  artistic_avg: number;
  emotional_avg_recent?: number;
  cognitive_avg_recent?: number;
  social_avg_recent?: number;
  communication_avg_recent?: number;
  contextual_avg_recent?: number;
  artistic_avg_recent?: number;
  recent_sources_analyzed?: number;
  fingerprint_confidence?: number;
  total_sources_analyzed: number;
}

interface FingerprintComparisonProps {
  fingerprints: UserFingerprint[];
  mode?: FingerprintMode;
}

const categories = [
  { key: "emotional_avg", recentKey: "emotional_avg_recent", name: "Emotional", color: "#ef4444", icon: Heart },
  { key: "cognitive_avg", recentKey: "cognitive_avg_recent", name: "Cognitive", color: "#3b82f6", icon: Brain },
  { key: "social_avg", recentKey: "social_avg_recent", name: "Social", color: "#22c55e", icon: Users },
  { key: "communication_avg", recentKey: "communication_avg_recent", name: "Communication", color: "#eab308", icon: MessageCircle },
  { key: "contextual_avg", recentKey: "contextual_avg_recent", name: "Contextual", color: "#a855f7", icon: Map },
  { key: "artistic_avg", recentKey: "artistic_avg_recent", name: "Artistic", color: "#ec4899", icon: Palette },
];

const userColors = [
  "#06b6d4", "#f97316", "#84cc16", "#6366f1",
  "#f43f5e", "#14b8a6", "#8b5cf6", "#ec4899",
];

function valueFor(fp: UserFingerprint, cat: typeof categories[number], mode: FingerprintMode): number {
  const key = mode === "recent" ? cat.recentKey : cat.key;
  return Number((fp as any)[key]) || 0;
}

function calculateSimilarity(fp1: UserFingerprint, fp2: UserFingerprint, mode: FingerprintMode = "all"): number {
  return sharedSimilarity(fp1 as any, fp2 as any, mode);
}

// Single radar chart that can overlay multiple fingerprints
const OverlayRadarChart = ({
  fingerprints,
  selectedIds,
  mode,
  size = 400,
}: {
  fingerprints: UserFingerprint[];
  selectedIds: string[];
  mode: FingerprintMode;
  size?: number;
}) => {
  const selected = fingerprints.filter(fp => selectedIds.includes(fp.user_id));

  const centerX = size / 2;
  const centerY = size / 2;
  const maxRadius = size / 2 - 60;
  const labelOffset = 45;

  const gridCircles = [20, 40, 60, 80, 100];

  const allPoints = selected.map((fp, fpIndex) => {
    return categories.map((cat, i) => {
      const angle = (Math.PI * 2 * i) / categories.length - Math.PI / 2;
      const value = valueFor(fp, cat, mode);
      const radius = (value / 100) * maxRadius;
      return {
        x: centerX + radius * Math.cos(angle),
        y: centerY + radius * Math.sin(angle),
        value,
        color: userColors[fpIndex % userColors.length],
      };
    });
  });

  // Axis label positions
  const axisLabels = categories.map((cat, i) => {
    const angle = (Math.PI * 2 * i) / categories.length - Math.PI / 2;
    return {
      x: centerX + (maxRadius + labelOffset) * Math.cos(angle),
      y: centerY + (maxRadius + labelOffset) * Math.sin(angle),
      name: cat.name,
      color: cat.color,
    };
  });

  return (
    <svg width={size} height={size} className="mx-auto">
      {/* Grid circles */}
      {gridCircles.map((percent) => (
        <circle
          key={percent}
          cx={centerX}
          cy={centerY}
          r={(percent / 100) * maxRadius}
          fill="none"
          stroke="hsl(var(--border))"
          strokeWidth={percent === 100 ? 1.5 : 0.5}
          strokeDasharray={percent === 100 ? "none" : "4 4"}
          opacity={0.5}
        />
      ))}

      {/* Grid labels */}
      {gridCircles.map((percent) => (
        <text
          key={`label-${percent}`}
          x={centerX + 5}
          y={centerY - (percent / 100) * maxRadius + 4}
          className="fill-muted-foreground text-[10px]"
        >
          {percent}
        </text>
      ))}

      {/* Axis lines */}
      {categories.map((_, i) => {
        const angle = (Math.PI * 2 * i) / categories.length - Math.PI / 2;
        return (
          <line
            key={`axis-${i}`}
            x1={centerX}
            y1={centerY}
            x2={centerX + maxRadius * Math.cos(angle)}
            y2={centerY + maxRadius * Math.sin(angle)}
            stroke="hsl(var(--border))"
            strokeWidth={0.5}
            opacity={0.5}
          />
        );
      })}

      {/* Axis labels */}
      {axisLabels.map((label, i) => (
        <text
          key={`axislabel-${i}`}
          x={label.x}
          y={label.y}
          textAnchor="middle"
          dominantBaseline="middle"
          className="fill-foreground text-xs font-medium"
        >
          {label.name}
        </text>
      ))}

      {/* Filled polygons for each user */}
      {allPoints.map((points, fpIndex) => {
        const path = points.map((p, i) => 
          `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`
        ).join(' ') + ' Z';

        return (
          <g key={`fp-${fpIndex}`}>
            <path
              d={path}
              fill={`${points[0].color}20`}
              stroke={points[0].color}
              strokeWidth={2.5}
              strokeLinejoin="round"
            />
            {/* Data points */}
            {points.map((p, i) => (
              <circle
                key={`point-${fpIndex}-${i}`}
                cx={p.x}
                cy={p.y}
                r={5}
                fill={p.color}
                stroke="hsl(var(--background))"
                strokeWidth={2}
              />
            ))}
          </g>
        );
      })}
    </svg>
  );
};

export const FingerprintComparison = ({ fingerprints, mode = "all" }: FingerprintComparisonProps) => {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const toggleSelection = (userId: string) => {
    setSelectedIds(prev =>
      prev.includes(userId)
        ? prev.filter(id => id !== userId)
        : [...prev, userId]
    );
  };

  const clearSelection = () => setSelectedIds([]);

  const selectedFingerprints = fingerprints.filter(fp => selectedIds.includes(fp.user_id));

  // Calculate pairwise similarities for selected users (mode-aware)
  const similarities = useMemo(() => {
    if (selectedFingerprints.length < 2) return [];

    const pairs: { user1: string; user2: string; similarity: number }[] = [];
    for (let i = 0; i < selectedFingerprints.length; i++) {
      for (let j = i + 1; j < selectedFingerprints.length; j++) {
        pairs.push({
          user1: selectedFingerprints[i].username || 'User',
          user2: selectedFingerprints[j].username || 'User',
          similarity: calculateSimilarity(selectedFingerprints[i], selectedFingerprints[j], mode),
        });
      }
    }
    return pairs.sort((a, b) => b.similarity - a.similarity);
  }, [selectedFingerprints, mode]);

  // Average similarity
  const avgSimilarity = similarities.length > 0
    ? similarities.reduce((sum, p) => sum + p.similarity, 0) / similarities.length
    : 0;

  // Generate insights summary (mode-aware)
  const insightsSummary = useMemo(() => {
    if (selectedFingerprints.length < 2) return null;

    const categoryStats = categories.map(cat => {
      const values = selectedFingerprints.map(fp => valueFor(fp, cat, mode));
      const avg = values.reduce((a, b) => a + b, 0) / values.length;
      const variance = values.reduce((sum, v) => sum + Math.pow(v - avg, 2), 0) / values.length;
      const max = Math.max(...values);
      const min = Math.min(...values);
      return { ...cat, avg, variance, max, min, range: max - min };
    });

    const mostVariant = [...categoryStats].sort((a, b) => b.variance - a.variance)[0];
    const mostConsistent = [...categoryStats].sort((a, b) => a.variance - b.variance)[0];
    const highestAvg = [...categoryStats].sort((a, b) => b.avg - a.avg)[0];
    
    // Find most similar and most different pairs
    const mostSimilar = similarities[0];
    const leastSimilar = similarities[similarities.length - 1];

    // Build insights
    const insights: string[] = [];

    // Similarity insight
    if (avgSimilarity > 0.95) {
      insights.push(`These users show remarkably high alignment (${(avgSimilarity * 100).toFixed(0)}% similar), suggesting shared ontological patterns across most categories.`);
    } else if (avgSimilarity > 0.85) {
      insights.push(`The selected users demonstrate strong similarity (${(avgSimilarity * 100).toFixed(0)}%), with ${mostConsistent.name} being their most aligned category.`);
    } else if (avgSimilarity > 0.7) {
      insights.push(`These users share moderate similarity (${(avgSimilarity * 100).toFixed(0)}%), indicating overlapping but distinct ontological profiles.`);
    } else {
      insights.push(`The selected users show significant divergence (${(avgSimilarity * 100).toFixed(0)}% similar), reflecting distinct ontological identities.`);
    }

    // Variance insight
    if (mostVariant.range > 30) {
      insights.push(`${mostVariant.name} shows the widest variation (range: ${mostVariant.range.toFixed(0)} points), making it the most distinctive differentiator among these users.`);
    } else if (mostConsistent.range < 10) {
      insights.push(`All users align closely on ${mostConsistent.name} (within ${mostConsistent.range.toFixed(0)} points), suggesting shared values in this dimension.`);
    } else {
      insights.push(`${highestAvg.name} is the strongest shared trait (avg: ${highestAvg.avg.toFixed(0)}), while ${mostVariant.name} shows the most individual variation.`);
    }

    // Pair insight for 3+ users
    if (similarities.length > 1 && mostSimilar && leastSimilar && mostSimilar !== leastSimilar) {
      insights.push(`${mostSimilar.user1} and ${mostSimilar.user2} are most aligned (${(mostSimilar.similarity * 100).toFixed(0)}%), while ${leastSimilar.user1} and ${leastSimilar.user2} diverge most (${(leastSimilar.similarity * 100).toFixed(0)}%).`);
    }

    return insights.slice(0, 3).join(' ');
  }, [selectedFingerprints, similarities, avgSimilarity, mode]);

  if (fingerprints.length === 0) {
    return (
      <Card className="p-8 text-center">
        <GitCompare className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
        <p className="text-lg text-muted-foreground">
          No user fingerprints available for comparison.
        </p>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* User Selection */}
      <Card className="p-4 bg-card/80">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <GitCompare className="h-5 w-5 text-primary" />
            <h4 className="font-semibold text-foreground">Select Users to Compare</h4>
            {selectedIds.length > 0 && (
              <Badge variant="secondary">{selectedIds.length} selected</Badge>
            )}
          </div>
          {selectedIds.length > 0 && (
            <Button variant="ghost" size="sm" onClick={clearSelection}>
              Clear All
            </Button>
          )}
        </div>

        <ScrollArea className="h-[200px]">
          <div className="grid gap-2 pr-4">
            {fingerprints.map((fp, index) => {
              const isSelected = selectedIds.includes(fp.user_id);
              const color = isSelected 
                ? userColors[selectedIds.indexOf(fp.user_id) % userColors.length]
                : undefined;

              return (
                <div
                  key={fp.user_id}
                  className={`flex items-center gap-3 p-3 rounded-lg border transition-all cursor-pointer ${
                    isSelected
                      ? 'border-primary/50 bg-primary/5'
                      : 'border-border/50 hover:bg-secondary/20'
                  }`}
                  onClick={() => toggleSelection(fp.user_id)}
                >
                  <Checkbox checked={isSelected} />
                  <div 
                    className="w-1 h-8 rounded-full"
                    style={{ backgroundColor: color || 'transparent' }}
                  />
                  <Avatar className="h-8 w-8">
                    <AvatarImage src={fp.avatar_url || undefined} />
                    <AvatarFallback><User className="h-4 w-4" /></AvatarFallback>
                  </Avatar>
                  <div className="flex-1">
                    <p className="font-medium text-foreground text-sm">
                      {fp.username || 'Anonymous'}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {fp.total_sources_analyzed} sources analyzed
                    </p>
                  </div>
                  {isSelected && (
                    <div 
                      className="w-4 h-4 rounded-full"
                      style={{ backgroundColor: color }}
                    />
                  )}
                </div>
              );
            })}
          </div>
        </ScrollArea>
      </Card>

      {/* Insights Summary */}
      {insightsSummary && (
        <Card className="p-4 bg-gradient-to-r from-primary/5 to-secondary/5 border-primary/20">
          <div className="flex items-start gap-3">
            <div className="p-2 rounded-full bg-primary/10">
              <Brain className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h4 className="font-semibold text-foreground mb-1">Insights</h4>
              <p className="text-sm text-muted-foreground leading-relaxed">
                {insightsSummary}
              </p>
            </div>
          </div>
        </Card>
      )}

      {/* Comparison View */}
      {selectedIds.length >= 2 ? (
        <div className="grid lg:grid-cols-2 gap-6">
          {/* Overlay Radar Chart */}
          <Card className="p-6 bg-card/80">
            <h4 className="font-semibold text-foreground mb-4">Overlaid Fingerprints</h4>
            <OverlayRadarChart
              fingerprints={fingerprints}
              selectedIds={selectedIds}
              mode={mode}
              size={380}
            />
            
            {/* Legend */}
            <div className="mt-4 flex flex-wrap gap-2 justify-center">
              {selectedFingerprints.map((fp, index) => (
                <div
                  key={fp.user_id}
                  className="flex items-center gap-2 px-2 py-1 rounded-full text-xs"
                  style={{ 
                    backgroundColor: `${userColors[index % userColors.length]}20`,
                    borderColor: userColors[index % userColors.length],
                    borderWidth: 1
                  }}
                >
                  <div 
                    className="w-3 h-3 rounded-full"
                    style={{ backgroundColor: userColors[index % userColors.length] }}
                  />
                  <span>{fp.username || 'User'}</span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleSelection(fp.user_id);
                    }}
                    className="hover:bg-secondary/50 rounded-full p-0.5"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          </Card>

          {/* Side-by-Side Comparison Table */}
          <Card className="p-6 bg-card/80">
            <h4 className="font-semibold text-foreground mb-4">Category Comparison</h4>
            
            {/* Similarity Score */}
            <div className="mb-6 p-4 rounded-lg bg-primary/5 border border-primary/20">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-muted-foreground">Average Similarity</span>
                <span className="text-2xl font-bold text-primary">
                  {(avgSimilarity * 100).toFixed(0)}%
                </span>
              </div>
              <div className="h-2 bg-secondary rounded-full overflow-hidden">
                <div 
                  className="h-full bg-primary rounded-full transition-all"
                  style={{ width: `${avgSimilarity * 100}%` }}
                />
              </div>
            </div>

            {/* Category bars */}
            <div className="space-y-4">
              {categories.map(cat => {
                const Icon = cat.icon;
                const values = selectedFingerprints.map(fp => 
                  Number(fp[cat.key as keyof UserFingerprint]) || 0
                );
                const maxVal = Math.max(...values);
                const minVal = Math.min(...values);
                const range = maxVal - minVal;

                return (
                  <div key={cat.key} className="space-y-2">
                    <div className="flex items-center gap-2">
                      <Icon className="h-4 w-4" style={{ color: cat.color }} />
                      <span className="text-sm font-medium text-foreground">{cat.name}</span>
                      <span className="text-xs text-muted-foreground ml-auto">
                        Range: {range.toFixed(0)}
                      </span>
                    </div>
                    <div className="relative h-6 bg-secondary/50 rounded-full overflow-hidden">
                      {selectedFingerprints.map((fp, index) => {
                        const value = Number(fp[cat.key as keyof UserFingerprint]) || 0;
                        const color = userColors[index % userColors.length];
                        return (
                          <div
                            key={fp.user_id}
                            className="absolute h-1.5 rounded-full"
                            style={{
                              backgroundColor: color,
                              width: `${value}%`,
                              top: 4 + index * 6,
                              left: 0,
                            }}
                          />
                        );
                      })}
                    </div>
                    <div className="flex justify-between text-xs text-muted-foreground">
                      {selectedFingerprints.map((fp, index) => (
                        <div 
                          key={fp.user_id}
                          className="flex items-center gap-1"
                        >
                          <div 
                            className="w-2 h-2 rounded-full"
                            style={{ backgroundColor: userColors[index % userColors.length] }}
                          />
                          <span>{(Number(fp[cat.key as keyof UserFingerprint]) || 0).toFixed(0)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>
        </div>
      ) : selectedIds.length === 1 ? (
        <Card className="p-8 text-center bg-card/80">
          <GitCompare className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
          <p className="text-lg text-muted-foreground">
            Select at least one more user to compare fingerprints
          </p>
        </Card>
      ) : (
        <Card className="p-8 text-center bg-card/80">
          <GitCompare className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
          <p className="text-lg text-muted-foreground">
            Select 2 or more users from the list above to compare their ontological fingerprints
          </p>
        </Card>
      )}

      {/* Pairwise Similarities */}
      {similarities.length > 0 && (
        <Card className="p-6 bg-card/80">
          <h4 className="font-semibold text-foreground mb-4">Pairwise Similarity Matrix</h4>
          <div className="grid gap-2">
            {similarities.map((pair, i) => (
              <div 
                key={i}
                className="flex items-center justify-between p-3 rounded-lg bg-secondary/20"
              >
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-foreground">{pair.user1}</span>
                  <span className="text-muted-foreground">↔</span>
                  <span className="text-sm font-medium text-foreground">{pair.user2}</span>
                </div>
                <div className="flex items-center gap-3">
                  <div className="w-24 h-2 bg-secondary rounded-full overflow-hidden">
                    <div 
                      className="h-full bg-primary rounded-full"
                      style={{ width: `${pair.similarity * 100}%` }}
                    />
                  </div>
                  <span className="text-sm font-bold text-primary w-12 text-right">
                    {(pair.similarity * 100).toFixed(0)}%
                  </span>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
};
