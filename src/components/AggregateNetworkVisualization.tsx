import { useRef, useEffect, useState, useMemo } from "react";
import * as d3 from "d3";
import { Card } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { User, Heart, Brain, Users, MessageCircle, Map, Palette, Layers } from "lucide-react";
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

interface Cluster {
  id: number;
  centroid: number[];
  members: UserFingerprint[];
  color: string;
  label: string;
  dominantCategory: typeof categories[0];
}

const categories = [
  { key: "emotional_avg", name: "Emotional", color: "#ef4444", icon: Heart },
  { key: "cognitive_avg", name: "Cognitive", color: "#3b82f6", icon: Brain },
  { key: "social_avg", name: "Social", color: "#22c55e", icon: Users },
  { key: "communication_avg", name: "Communication", color: "#eab308", icon: MessageCircle },
  { key: "contextual_avg", name: "Contextual", color: "#a855f7", icon: Map },
  { key: "artistic_avg", name: "Artistic", color: "#ec4899", icon: Palette },
];

// Cluster colors (distinct from category colors)
const clusterColors = [
  "#06b6d4", // cyan
  "#f97316", // orange
  "#84cc16", // lime
  "#6366f1", // indigo
  "#f43f5e", // rose
  "#14b8a6", // teal
];

// Get fingerprint as vector
function getVector(fp: UserFingerprint): number[] {
  return categories.map(c => Number(fp[c.key as keyof UserFingerprint]) || 0);
}

// Calculate Euclidean distance between two vectors
function euclideanDistance(v1: number[], v2: number[]): number {
  return Math.sqrt(v1.reduce((sum, val, i) => sum + Math.pow(val - v2[i], 2), 0));
}

// Calculate cosine similarity between two fingerprints
function calculateSimilarity(fp1: UserFingerprint, fp2: UserFingerprint): number {
  const values1 = getVector(fp1);
  const values2 = getVector(fp2);
  
  const dotProduct = values1.reduce((sum, v, i) => sum + v * values2[i], 0);
  const magnitude1 = Math.sqrt(values1.reduce((sum, v) => sum + v * v, 0));
  const magnitude2 = Math.sqrt(values2.reduce((sum, v) => sum + v * v, 0));
  
  if (magnitude1 === 0 || magnitude2 === 0) return 0;
  return dotProduct / (magnitude1 * magnitude2);
}

// Get dominant category for a fingerprint or centroid
function getDominantCategory(values: number[]) {
  let maxIdx = 0;
  let maxVal = 0;
  values.forEach((val, i) => {
    if (val > maxVal) {
      maxVal = val;
      maxIdx = i;
    }
  });
  return categories[maxIdx];
}

// K-Means clustering implementation
function kMeansClustering(fingerprints: UserFingerprint[], k: number, maxIterations = 50): Cluster[] {
  if (fingerprints.length < k) {
    k = fingerprints.length;
  }
  if (k <= 0) return [];

  const vectors = fingerprints.map(getVector);
  
  // Initialize centroids using k-means++ algorithm
  const centroids: number[][] = [];
  const usedIndices = new Set<number>();
  
  // First centroid: random
  const firstIdx = Math.floor(Math.random() * vectors.length);
  centroids.push([...vectors[firstIdx]]);
  usedIndices.add(firstIdx);
  
  // Remaining centroids: choose based on distance
  while (centroids.length < k) {
    const distances = vectors.map((v, idx) => {
      if (usedIndices.has(idx)) return 0;
      const minDist = Math.min(...centroids.map(c => euclideanDistance(v, c)));
      return minDist * minDist;
    });
    
    const totalDist = distances.reduce((a, b) => a + b, 0);
    let random = Math.random() * totalDist;
    
    for (let i = 0; i < distances.length; i++) {
      random -= distances[i];
      if (random <= 0 && !usedIndices.has(i)) {
        centroids.push([...vectors[i]]);
        usedIndices.add(i);
        break;
      }
    }
  }

  let assignments: number[] = new Array(vectors.length).fill(0);
  
  // Iterate
  for (let iter = 0; iter < maxIterations; iter++) {
    // Assign each point to nearest centroid
    const newAssignments = vectors.map(v => {
      let minDist = Infinity;
      let minIdx = 0;
      centroids.forEach((c, i) => {
        const dist = euclideanDistance(v, c);
        if (dist < minDist) {
          minDist = dist;
          minIdx = i;
        }
      });
      return minIdx;
    });

    // Check for convergence
    if (newAssignments.every((a, i) => a === assignments[i])) {
      break;
    }
    assignments = newAssignments;

    // Update centroids
    for (let c = 0; c < k; c++) {
      const clusterPoints = vectors.filter((_, i) => assignments[i] === c);
      if (clusterPoints.length > 0) {
        centroids[c] = categories.map((_, catIdx) => 
          clusterPoints.reduce((sum, p) => sum + p[catIdx], 0) / clusterPoints.length
        );
      }
    }
  }

  // Build cluster objects
  const clusters: Cluster[] = centroids.map((centroid, idx) => {
    const members = fingerprints.filter((_, i) => assignments[i] === idx);
    const dominantCategory = getDominantCategory(centroid);
    
    return {
      id: idx,
      centroid,
      members,
      color: clusterColors[idx % clusterColors.length],
      label: `${dominantCategory.name}-dominant`,
      dominantCategory,
    };
  }).filter(c => c.members.length > 0);

  return clusters;
}

// Determine optimal number of clusters using elbow method heuristic
function determineOptimalK(fingerprints: UserFingerprint[]): number {
  if (fingerprints.length <= 2) return 1;
  if (fingerprints.length <= 4) return 2;
  if (fingerprints.length <= 8) return 3;
  return Math.min(5, Math.ceil(fingerprints.length / 3));
}

export const AggregateNetworkVisualization = ({ 
  fingerprints,
  onUserClick 
}: AggregateNetworkVisualizationProps) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hoveredUser, setHoveredUser] = useState<UserFingerprint | null>(null);
  const [hoveredCluster, setHoveredCluster] = useState<Cluster | null>(null);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });

  // Compute clusters
  const clusters = useMemo(() => {
    if (fingerprints.length < 2) return [];
    const k = determineOptimalK(fingerprints);
    return kMeansClustering(fingerprints, k);
  }, [fingerprints]);

  // Map user_id to cluster
  const userClusterMap = useMemo((): globalThis.Map<string, Cluster> => {
    const map = new globalThis.Map<string, Cluster>();
    clusters.forEach(cluster => {
      cluster.members.forEach(member => {
        map.set(member.user_id, cluster);
      });
    });
    return map;
  }, [clusters]);

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

    // Create nodes from fingerprints with cluster info
    const nodes = fingerprints.map((fp, i) => {
      const cluster = userClusterMap.get(fp.user_id);
      return {
        id: fp.user_id,
        fingerprint: fp,
        radius: 20 + (fp.total_sources_analyzed * 3),
        color: cluster?.color || getDominantCategory(getVector(fp)).color,
        cluster,
        x: width / 2 + (Math.random() - 0.5) * 200,
        y: height / 2 + (Math.random() - 0.5) * 200,
      };
    });

    // Create links based on similarity threshold
    const links: { source: any; target: any; similarity: number; sameCluster: boolean }[] = [];
    for (let i = 0; i < fingerprints.length; i++) {
      for (let j = i + 1; j < fingerprints.length; j++) {
        const similarity = calculateSimilarity(fingerprints[i], fingerprints[j]);
        const sameCluster = userClusterMap.get(fingerprints[i].user_id)?.id === 
                           userClusterMap.get(fingerprints[j].user_id)?.id;
        if (similarity > 0.6 || sameCluster) {
          links.push({
            source: nodes[i],
            target: nodes[j],
            similarity,
            sameCluster,
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

    // Cluster hulls group (drawn first, behind everything)
    const hullGroup = svg.append("g").attr("class", "hulls");

    // Draw links
    const linkGroup = svg.append("g").attr("class", "links");
    linkGroup.selectAll("line")
      .data(links)
      .join("line")
      .attr("stroke", (d) => d.sameCluster ? d.source.color : "hsl(var(--muted-foreground))")
      .attr("stroke-opacity", (d) => d.sameCluster ? 0.4 : 0.15)
      .attr("stroke-width", (d) => d.sameCluster ? 2 : 1)
      .attr("stroke-dasharray", (d) => d.sameCluster ? "none" : "4 4");

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

    // Fingerprint contour rings around each user
    const numRings = 8;
    for (let ring = numRings; ring >= 1; ring--) {
      nodeElements.append("ellipse")
        .attr("rx", (d) => d.radius + ring * 6 + Math.sin(ring * 0.7) * 3)
        .attr("ry", (d) => d.radius + ring * 6 - Math.sin(ring * 0.5) * 2)
        .attr("cx", (d) => Math.sin(ring * 0.8 + d.radius) * 2)
        .attr("cy", (d) => Math.cos(ring * 0.6 + d.radius) * 1.5)
        .attr("fill", "none")
        .attr("stroke", (d) => d.color)
        .attr("stroke-width", 1.2 - ring * 0.08)
        .attr("stroke-opacity", 0.15 + (numRings - ring) * 0.03)
        .attr("stroke-dasharray", ring % 2 === 0 ? "none" : "4 2");
    }

    // Main circle
    nodeElements.append("circle")
      .attr("r", (d) => d.radius)
      .attr("fill", (d) => d.color)
      .attr("stroke", "hsl(var(--background))")
      .attr("stroke-width", 2);

    // SAM logo in center of each user node
    nodeElements.append("image")
      .attr("href", "/images/sam-logo.png")
      .attr("width", (d) => d.radius * 1.4)
      .attr("height", (d) => d.radius * 0.7)
      .attr("x", (d) => -d.radius * 0.7)
      .attr("y", (d) => -d.radius * 0.35)
      .attr("opacity", 0.85)
      .style("pointer-events", "none");

    // Username label
    nodeElements.append("text")
      .attr("text-anchor", "middle")
      .attr("y", (d) => d.radius + 20)
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
        setHoveredCluster(d.cluster || null);
        setTooltipPos({ x: event.pageX, y: event.pageY });
        d3.select(this).select("circle:nth-child(3)")
          .transition()
          .duration(200)
          .attr("r", d.radius * 1.2);
      })
      .on("mouseleave", function(event, d) {
        setHoveredUser(null);
        setHoveredCluster(null);
        d3.select(this).select("circle:nth-child(3)")
          .transition()
          .duration(200)
          .attr("r", d.radius);
      })
      .on("click", (event, d) => {
        if (onUserClick) onUserClick(d.id);
      });

    // Force simulation with cluster forces
    const simulation = d3.forceSimulation(nodes as any)
      .force("link", d3.forceLink(links).distance((d: any) => d.sameCluster ? 80 : 150))
      .force("charge", d3.forceManyBody().strength(-250))
      .force("center", d3.forceCenter(width / 2, height / 2))
      .force("collision", d3.forceCollide().radius((d: any) => d.radius + 25))
      // Cluster force: pull nodes toward their cluster center
      .force("cluster", (alpha: number) => {
        nodes.forEach(node => {
          if (!node.cluster) return;
          const clusterNodes = nodes.filter(n => n.cluster?.id === node.cluster?.id);
          if (clusterNodes.length < 2) return;
          
          // Calculate cluster center
          const cx = clusterNodes.reduce((sum, n) => sum + (n.x || 0), 0) / clusterNodes.length;
          const cy = clusterNodes.reduce((sum, n) => sum + (n.y || 0), 0) / clusterNodes.length;
          
          // Pull toward cluster center
          const strength = alpha * 0.1;
          (node as any).vx += (cx - (node.x || 0)) * strength;
          (node as any).vy += (cy - (node.y || 0)) * strength;
        });
      })
      .on("tick", () => {
        // Update convex hulls for clusters
        hullGroup.selectAll("path").remove();
        clusters.forEach(cluster => {
          const clusterNodes = nodes.filter(n => n.cluster?.id === cluster.id);
          if (clusterNodes.length >= 3) {
            const points: [number, number][] = clusterNodes.map(n => [n.x || 0, n.y || 0]);
            const hull = d3.polygonHull(points);
            if (hull) {
              // Expand hull slightly
              const expandedHull = hull.map(([x, y]) => {
                const cx = points.reduce((sum, p) => sum + p[0], 0) / points.length;
                const cy = points.reduce((sum, p) => sum + p[1], 0) / points.length;
                const dx = x - cx;
                const dy = y - cy;
                const dist = Math.sqrt(dx * dx + dy * dy);
                const expansion = 40;
                return [x + (dx / dist) * expansion, y + (dy / dist) * expansion] as [number, number];
              });

              hullGroup.append("path")
                .attr("d", `M${expandedHull.join("L")}Z`)
                .attr("fill", cluster.color)
                .attr("fill-opacity", 0.08)
                .attr("stroke", cluster.color)
                .attr("stroke-opacity", 0.3)
                .attr("stroke-width", 2)
                .attr("stroke-dasharray", "8 4");
            }
          }
        });

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
  }, [fingerprints, clusters, userClusterMap, onUserClick]);

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
              {clusters.length} cluster{clusters.length !== 1 ? 's' : ''} detected
            </p>
          </div>
        </div>

        {/* Cluster legend in top right */}
        {clusters.length > 0 && (
          <div className="absolute top-4 right-4 z-10 bg-card/90 backdrop-blur-sm rounded-lg p-3 border border-border/50">
            <div className="flex items-center gap-2 mb-2">
              <Layers className="h-4 w-4 text-muted-foreground" />
              <span className="text-xs font-semibold text-foreground">Communities</span>
            </div>
            <div className="space-y-1">
              {clusters.map(cluster => (
                <div 
                  key={cluster.id} 
                  className="flex items-center gap-2 text-xs"
                  onMouseEnter={() => setHoveredCluster(cluster)}
                  onMouseLeave={() => setHoveredCluster(null)}
                >
                  <div 
                    className="w-3 h-3 rounded-full border-2"
                    style={{ backgroundColor: cluster.color, borderColor: cluster.color }}
                  />
                  <span className="text-muted-foreground">{cluster.label}</span>
                  <Badge variant="secondary" className="text-[10px] px-1 py-0">
                    {cluster.members.length}
                  </Badge>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Network visualization */}
        <svg ref={svgRef} className="w-full h-[500px]" />

        {/* Hover tooltip */}
        {hoveredUser && (
          <div 
            className="fixed z-50 bg-popover border border-border rounded-lg shadow-lg p-3 pointer-events-none"
            style={{ 
              left: tooltipPos.x + 15, 
              top: tooltipPos.y + 15,
              maxWidth: 280
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
            {hoveredCluster && (
              <div 
                className="flex items-center gap-2 mb-2 px-2 py-1 rounded-full text-xs"
                style={{ backgroundColor: `${hoveredCluster.color}20` }}
              >
                <div 
                  className="w-2 h-2 rounded-full"
                  style={{ backgroundColor: hoveredCluster.color }}
                />
                <span style={{ color: hoveredCluster.color }}>{hoveredCluster.label}</span>
              </div>
            )}
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

      {/* Cluster Analysis */}
      {clusters.length > 0 && (
        <Card className="p-6 bg-card/80">
          <div className="flex items-center gap-2 mb-4">
            <Layers className="h-5 w-5 text-primary" />
            <h4 className="font-semibold text-foreground">Community Clusters</h4>
          </div>
          
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {clusters.map(cluster => {
              const Icon = cluster.dominantCategory.icon;
              return (
                <div 
                  key={cluster.id}
                  className="p-4 rounded-lg border-2 transition-colors"
                  style={{ 
                    borderColor: cluster.color,
                    backgroundColor: `${cluster.color}08`
                  }}
                >
                  <div className="flex items-center gap-2 mb-3">
                    <div 
                      className="p-2 rounded-full"
                      style={{ backgroundColor: `${cluster.color}20` }}
                    >
                      <Icon className="h-4 w-4" style={{ color: cluster.color }} />
                    </div>
                    <div>
                      <p className="font-medium text-foreground">{cluster.label}</p>
                      <p className="text-xs text-muted-foreground">
                        {cluster.members.length} member{cluster.members.length !== 1 ? 's' : ''}
                      </p>
                    </div>
                  </div>
                  
                  {/* Cluster centroid profile */}
                  <div className="space-y-1 mb-3">
                    {categories.map((cat, idx) => (
                      <div key={cat.key} className="flex items-center gap-2 text-xs">
                        <span className="text-muted-foreground w-20 truncate">{cat.name}</span>
                        <div className="flex-1 h-1.5 bg-secondary rounded-full overflow-hidden">
                          <div 
                            className="h-full rounded-full"
                            style={{ 
                              width: `${cluster.centroid[idx]}%`,
                              backgroundColor: cat.color 
                            }}
                          />
                        </div>
                        <span className="font-medium w-6 text-right">
                          {cluster.centroid[idx].toFixed(0)}
                        </span>
                      </div>
                    ))}
                  </div>

                  {/* Member avatars */}
                  <div className="flex flex-wrap gap-1">
                    {cluster.members.slice(0, 6).map(member => (
                      <Avatar 
                        key={member.user_id} 
                        className="h-6 w-6 border-2"
                        style={{ borderColor: cluster.color }}
                      >
                        <AvatarImage src={member.avatar_url || undefined} />
                        <AvatarFallback className="text-[10px]">
                          {member.username?.charAt(0).toUpperCase() || "U"}
                        </AvatarFallback>
                      </Avatar>
                    ))}
                    {cluster.members.length > 6 && (
                      <div 
                        className="h-6 w-6 rounded-full flex items-center justify-center text-[10px] font-medium"
                        style={{ backgroundColor: `${cluster.color}20`, color: cluster.color }}
                      >
                        +{cluster.members.length - 6}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      )}

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
          Dashed outlines show cluster boundaries • Solid lines connect similar users within clusters
        </p>
      </Card>
    </div>
  );
};
