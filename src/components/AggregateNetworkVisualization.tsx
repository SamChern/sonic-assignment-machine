import { useRef, useEffect, useState, useMemo } from "react";
import * as d3 from "d3";
import { Card } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { User, Heart, Brain, Users, MessageCircle, Map, Palette } from "lucide-react";
import samLogo from "@/assets/sam-logo.png";

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
  total_sources_analyzed: number;
}

interface AggregateNetworkVisualizationProps {
  fingerprints: UserFingerprint[];
  onUserClick?: (userId: string) => void;
}

const categories = [
  { key: "emotional_avg", name: "Emotional", color: "#ef4444", icon: Heart },
  { key: "cognitive_avg", name: "Cognitive", color: "#3b82f6", icon: Brain },
  { key: "social_avg", name: "Social", color: "#22c55e", icon: Users },
  { key: "communication_avg", name: "Communication", color: "#eab308", icon: MessageCircle },
  { key: "contextual_avg", name: "Contextual", color: "#a855f7", icon: Map },
  { key: "artistic_avg", name: "Artistic", color: "#ec4899", icon: Palette },
];

// Calculate cosine similarity between two fingerprints
function calculateSimilarity(fp1: UserFingerprint, fp2: UserFingerprint): number {
  const values1 = categories.map(c => Number(fp1[c.key as keyof UserFingerprint]) || 0);
  const values2 = categories.map(c => Number(fp2[c.key as keyof UserFingerprint]) || 0);
  
  const dotProduct = values1.reduce((sum, v, i) => sum + v * values2[i], 0);
  const magnitude1 = Math.sqrt(values1.reduce((sum, v) => sum + v * v, 0));
  const magnitude2 = Math.sqrt(values2.reduce((sum, v) => sum + v * v, 0));
  
  if (magnitude1 === 0 || magnitude2 === 0) return 0;
  return dotProduct / (magnitude1 * magnitude2);
}

// Get dominant category for a fingerprint
function getDominantCategory(fp: UserFingerprint) {
  let maxKey = "emotional_avg";
  let maxVal = 0;
  categories.forEach(cat => {
    const val = Number(fp[cat.key as keyof UserFingerprint]) || 0;
    if (val > maxVal) {
      maxVal = val;
      maxKey = cat.key;
    }
  });
  return categories.find(c => c.key === maxKey)!;
}

export const AggregateNetworkVisualization = ({ 
  fingerprints,
  onUserClick 
}: AggregateNetworkVisualizationProps) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hoveredUser, setHoveredUser] = useState<UserFingerprint | null>(null);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });

  // Calculate similarity metrics
  const similarityMetrics = useMemo(() => {
    if (fingerprints.length < 2) return null;

    const pairs: { user1: string; user2: string; similarity: number }[] = [];
    let totalSimilarity = 0;
    let pairCount = 0;

    for (let i = 0; i < fingerprints.length; i++) {
      for (let j = i + 1; j < fingerprints.length; j++) {
        const similarity = calculateSimilarity(fingerprints[i], fingerprints[j]);
        pairs.push({
          user1: fingerprints[i].username || 'User',
          user2: fingerprints[j].username || 'User',
          similarity,
        });
        totalSimilarity += similarity;
        pairCount++;
      }
    }

    // Category averages across all users
    const categoryAverages = categories.map(cat => {
      const avg = fingerprints.reduce((sum, fp) => 
        sum + (Number(fp[cat.key as keyof UserFingerprint]) || 0), 0
      ) / fingerprints.length;
      return { ...cat, avg };
    });

    return {
      averageSimilarity: pairCount > 0 ? totalSimilarity / pairCount : 0,
      pairs: pairs.sort((a, b) => b.similarity - a.similarity),
      categoryAverages,
    };
  }, [fingerprints]);

  useEffect(() => {
    if (!svgRef.current || fingerprints.length === 0) return;

    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();

    const width = svgRef.current.clientWidth || 800;
    const height = 500;

    svg.attr("width", width).attr("height", height);

    // Create nodes from fingerprints
    const nodes = fingerprints.map((fp, i) => ({
      id: fp.user_id,
      fingerprint: fp,
      radius: 20 + (fp.total_sources_analyzed * 3),
      color: getDominantCategory(fp).color,
      x: width / 2 + (Math.random() - 0.5) * 200,
      y: height / 2 + (Math.random() - 0.5) * 200,
    }));

    // Create links based on similarity threshold
    const links: { source: any; target: any; similarity: number }[] = [];
    for (let i = 0; i < fingerprints.length; i++) {
      for (let j = i + 1; j < fingerprints.length; j++) {
        const similarity = calculateSimilarity(fingerprints[i], fingerprints[j]);
        if (similarity > 0.7) { // Only show strong connections
          links.push({
            source: nodes[i],
            target: nodes[j],
            similarity,
          });
        }
      }
    }

    // Create gradient definitions
    const defs = svg.append("defs");
    
    // Background gradient
    const bgGradient = defs.append("radialGradient")
      .attr("id", "aggregate-bg-gradient");
    bgGradient.append("stop").attr("offset", "0%").attr("stop-color", "hsl(var(--primary))").attr("stop-opacity", 0.05);
    bgGradient.append("stop").attr("offset", "100%").attr("stop-color", "transparent");

    // Background
    svg.append("rect")
      .attr("width", width)
      .attr("height", height)
      .attr("fill", "url(#aggregate-bg-gradient)");

    // Draw links
    const linkGroup = svg.append("g").attr("class", "links");
    linkGroup.selectAll("line")
      .data(links)
      .join("line")
      .attr("stroke", "hsl(var(--primary))")
      .attr("stroke-opacity", (d) => d.similarity * 0.5)
      .attr("stroke-width", (d) => d.similarity * 3);

    // Draw nodes
    const nodeGroup = svg.append("g").attr("class", "nodes");
    const nodeElements = nodeGroup.selectAll("g")
      .data(nodes)
      .join("g")
      .attr("cursor", "pointer")
      .call(d3.drag<any, any>()
        .on("start", (event, d) => {
          if (!event.active) simulation.alphaTarget(0.3).restart();
          d.fx = d.x;
          d.fy = d.y;
        })
        .on("drag", (event, d) => {
          d.fx = event.x;
          d.fy = event.y;
        })
        .on("end", (event, d) => {
          if (!event.active) simulation.alphaTarget(0);
          d.fx = null;
          d.fy = null;
        })
      );

    // Glow effect
    nodeElements.append("circle")
      .attr("r", (d) => d.radius + 10)
      .attr("fill", (d) => d.color)
      .attr("opacity", 0.2);

    // Main circle
    nodeElements.append("circle")
      .attr("r", (d) => d.radius)
      .attr("fill", (d) => d.color)
      .attr("stroke", "hsl(var(--background))")
      .attr("stroke-width", 2);

    // User initial or avatar placeholder
    nodeElements.append("text")
      .attr("text-anchor", "middle")
      .attr("dominant-baseline", "middle")
      .attr("fill", "white")
      .attr("font-weight", "bold")
      .attr("font-size", (d) => d.radius * 0.6)
      .text((d) => d.fingerprint.username?.charAt(0).toUpperCase() || "U");

    // Username label
    nodeElements.append("text")
      .attr("text-anchor", "middle")
      .attr("y", (d) => d.radius + 16)
      .attr("fill", "hsl(var(--foreground))")
      .attr("font-size", 11)
      .attr("font-weight", 500)
      .text((d) => d.fingerprint.username || "User");

    // Source count badge
    nodeElements.append("circle")
      .attr("cx", (d) => d.radius * 0.7)
      .attr("cy", (d) => -d.radius * 0.7)
      .attr("r", 12)
      .attr("fill", "hsl(var(--background))")
      .attr("stroke", (d) => d.color)
      .attr("stroke-width", 2);

    nodeElements.append("text")
      .attr("x", (d) => d.radius * 0.7)
      .attr("y", (d) => -d.radius * 0.7)
      .attr("text-anchor", "middle")
      .attr("dominant-baseline", "middle")
      .attr("fill", "hsl(var(--foreground))")
      .attr("font-size", 9)
      .attr("font-weight", "bold")
      .text((d) => d.fingerprint.total_sources_analyzed);

    // Hover and click handlers
    nodeElements
      .on("mouseenter", function(event, d) {
        setHoveredUser(d.fingerprint);
        setTooltipPos({ x: event.pageX, y: event.pageY });
        d3.select(this).select("circle:nth-child(2)")
          .transition()
          .duration(200)
          .attr("r", d.radius * 1.2);
      })
      .on("mouseleave", function(event, d) {
        setHoveredUser(null);
        d3.select(this).select("circle:nth-child(2)")
          .transition()
          .duration(200)
          .attr("r", d.radius);
      })
      .on("click", (event, d) => {
        if (onUserClick) onUserClick(d.id);
      });

    // Force simulation
    const simulation = d3.forceSimulation(nodes as any)
      .force("link", d3.forceLink(links).distance(150))
      .force("charge", d3.forceManyBody().strength(-200))
      .force("center", d3.forceCenter(width / 2, height / 2))
      .force("collision", d3.forceCollide().radius((d: any) => d.radius + 20))
      .on("tick", () => {
        linkGroup.selectAll("line")
          .attr("x1", (d: any) => d.source.x)
          .attr("y1", (d: any) => d.source.y)
          .attr("x2", (d: any) => d.target.x)
          .attr("y2", (d: any) => d.target.y);

        nodeElements.attr("transform", (d: any) => `translate(${d.x}, ${d.y})`);
      });

    return () => {
      simulation.stop();
    };
  }, [fingerprints, onUserClick]);

  if (fingerprints.length === 0) {
    return (
      <Card className="p-8 text-center">
        <Users className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
        <p className="text-lg text-muted-foreground">
          No user fingerprints available. Users need to analyze audio sources first.
        </p>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card className="relative overflow-hidden bg-gradient-to-br from-card via-card to-card/80 border-border/50">
        {/* Header */}
        <div className="absolute top-4 left-4 z-10 flex items-center gap-3">
          <img src={samLogo} alt="SAM" className="w-10 h-10" />
          <div>
            <h3 className="text-lg font-bold text-foreground">Aggregate User Fingerprints</h3>
            <p className="text-xs text-muted-foreground">
              {fingerprints.length} user{fingerprints.length !== 1 ? 's' : ''} • 
              Bubble size = sources analyzed
            </p>
          </div>
        </div>

        {/* Network visualization */}
        <svg ref={svgRef} className="w-full h-[500px]" />

        {/* Hover tooltip */}
        {hoveredUser && (
          <div 
            className="fixed z-50 bg-popover border border-border rounded-lg shadow-lg p-3 pointer-events-none"
            style={{ 
              left: tooltipPos.x + 15, 
              top: tooltipPos.y + 15,
              maxWidth: 250
            }}
          >
            <div className="flex items-center gap-2 mb-2">
              <Avatar className="h-8 w-8">
                <AvatarImage src={hoveredUser.avatar_url || undefined} />
                <AvatarFallback><User className="h-4 w-4" /></AvatarFallback>
              </Avatar>
              <div>
                <p className="font-semibold text-foreground">{hoveredUser.username || "User"}</p>
                <p className="text-xs text-muted-foreground">{hoveredUser.total_sources_analyzed} sources</p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-1 text-xs">
              {categories.map(cat => (
                <div key={cat.key} className="flex items-center gap-1">
                  <div className="w-2 h-2 rounded-full" style={{ backgroundColor: cat.color }} />
                  <span className="text-muted-foreground">{cat.name}:</span>
                  <span className="font-medium">
                    {Number(hoveredUser[cat.key as keyof UserFingerprint]).toFixed(0)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </Card>

      {/* Similarity Metrics */}
      {similarityMetrics && (
        <Card className="p-6 bg-card/80">
          <h4 className="font-semibold text-foreground mb-4">Cross-User Similarity Analysis</h4>
          
          <div className="grid md:grid-cols-2 gap-6">
            {/* Overall similarity */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Average User Similarity</span>
                <span className="text-2xl font-bold text-primary">
                  {(similarityMetrics.averageSimilarity * 100).toFixed(0)}%
                </span>
              </div>
              <div className="h-2 bg-secondary rounded-full overflow-hidden">
                <div 
                  className="h-full bg-primary rounded-full transition-all"
                  style={{ width: `${similarityMetrics.averageSimilarity * 100}%` }}
                />
              </div>

              {/* Top similar pairs */}
              <div className="mt-4">
                <p className="text-sm font-medium text-foreground mb-2">Most Similar Users</p>
                <div className="space-y-1">
                  {similarityMetrics.pairs.slice(0, 3).map((pair, i) => (
                    <div key={i} className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">
                        {pair.user1} ↔ {pair.user2}
                      </span>
                      <span className="font-medium text-foreground">
                        {(pair.similarity * 100).toFixed(0)}%
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Category averages */}
            <div className="space-y-2">
              <p className="text-sm font-medium text-foreground mb-2">Community Category Profile</p>
              {similarityMetrics.categoryAverages.map(cat => {
                const Icon = cat.icon;
                return (
                  <div key={cat.key} className="flex items-center gap-2">
                    <Icon className="h-4 w-4" style={{ color: cat.color }} />
                    <span className="text-sm text-muted-foreground flex-1">{cat.name}</span>
                    <div className="w-24 h-2 bg-secondary rounded-full overflow-hidden">
                      <div 
                        className="h-full rounded-full"
                        style={{ 
                          width: `${cat.avg}%`,
                          backgroundColor: cat.color 
                        }}
                      />
                    </div>
                    <span className="text-sm font-medium w-8 text-right">{cat.avg.toFixed(0)}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </Card>
      )}

      {/* Legend */}
      <Card className="p-4 bg-card/50">
        <div className="flex flex-wrap items-center justify-center gap-4 text-sm">
          {categories.map(cat => {
            const Icon = cat.icon;
            return (
              <div key={cat.key} className="flex items-center gap-1.5">
                <div className="w-3 h-3 rounded-full" style={{ backgroundColor: cat.color }} />
                <Icon className="h-3 w-3" style={{ color: cat.color }} />
                <span className="text-muted-foreground">{cat.name}</span>
              </div>
            );
          })}
        </div>
        <p className="text-center text-xs text-muted-foreground mt-2">
          Node color indicates dominant category • Lines show similarity &gt;70%
        </p>
      </Card>
    </div>
  );
};
