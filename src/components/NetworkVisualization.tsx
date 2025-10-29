import { useEffect, useRef, useState } from "react";
import * as d3 from "d3";
import { Card } from "@/components/ui/card";
import samLogo from "@/assets/sam-logo.png";
import emotionIcon from "@/assets/emotion-sam.png";
import socialIcon from "@/assets/social-sam.png";

interface Node {
  id: string;
  sourceName: string;
  category: string;
  score: number;
  color: string;
  x?: number;
  y?: number;
  fx?: number | null;
  fy?: number | null;
}

interface Link {
  source: string | Node;
  target: string | Node;
  strength: number;
}

interface CategoryScore {
  name: string;
  score: number;
  description: string;
}

interface SourceAnalysis {
  name: string;
  categories: CategoryScore[];
}

interface CategorySimilarity {
  name: string;
  similarity: number;
  variance: number;
  interpretation: 'high' | 'moderate' | 'low';
}

interface SourcePairSimilarity {
  source1: string;
  source2: string;
  similarity: number;
}

interface SimilarityMetrics {
  overall: number;
  byCategory: CategorySimilarity[];
  sourcePairs: SourcePairSimilarity[];
  dominantCategory?: string;
  distinctiveCategory?: string;
}

interface NetworkVisualizationProps {
  sources: SourceAnalysis[];
  sourceImages?: Array<{ name: string; imageUrl: string }>;
}

export const NetworkVisualization = ({ sources, sourceImages = [] }: NetworkVisualizationProps) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const [similarityMetrics, setSimilarityMetrics] = useState<SimilarityMetrics>({
    overall: 0,
    byCategory: [],
    sourcePairs: [],
  });
  const [showDetails, setShowDetails] = useState(false);

  useEffect(() => {
    if (!svgRef.current || !sources.length) return;

    const width = svgRef.current.clientWidth;
    const height = svgRef.current.clientHeight;

    // Clear previous content
    d3.select(svgRef.current).selectAll("*").remove();

    // Blue and green gradient color palette for categories
    const categoryColors: Record<string, string> = {
      'Emotional': 'hsl(200, 85%, 55%)',
      'Cognitive': 'hsl(160, 75%, 50%)',
      'Social': 'hsl(180, 80%, 60%)',
      'Communication': 'hsl(140, 70%, 55%)',
      'Contextual': 'hsl(220, 75%, 60%)',
      'Artistic': 'hsl(170, 80%, 55%)',
    };

    // Check if we're viewing a single source's fingerprint
    const isSingleSource = sources.length === 1;

    // Create nodes: one for each source-category combination
    const nodes: Node[] = [];
    sources.forEach((source) => {
      source.categories.forEach(category => {
        nodes.push({
          id: `${source.name}::${category.name}`,
          sourceName: source.name,
          category: category.name,
          score: category.score,
          color: categoryColors[category.name] || 'hsl(180, 70%, 55%)',
        });
      });
    });

    // For single source fingerprint, arrange in a circular/radial pattern
    if (isSingleSource) {
      const centerX = width / 2;
      const centerY = height / 2;
      const radius = Math.min(width, height) * 0.3;
      
      nodes.forEach((node, index) => {
        const angle = (index / nodes.length) * 2 * Math.PI - Math.PI / 2;
        node.x = centerX + radius * Math.cos(angle);
        node.y = centerY + radius * Math.sin(angle);
        node.fx = node.x; // Fix positions for fingerprint view
        node.fy = node.y;
      });
    }

    // Calculate similarity between sources based on category score profiles
    const calculateSourceSimilarity = (source1: SourceAnalysis, source2: SourceAnalysis): number => {
      let totalDiff = 0;
      source1.categories.forEach((cat1, idx) => {
        const cat2 = source2.categories[idx];
        totalDiff += Math.abs(cat1.score - cat2.score);
      });
      const avgDiff = totalDiff / source1.categories.length;
      return Math.max(0, 1 - avgDiff / 100); // Convert to 0-1 similarity
    };

    // Calculate category similarity across all sources for that category
    const calculateCategorySimilarity = (categoryName: string): { similarity: number; variance: number } => {
      const categoryScores = sources.map(s => 
        s.categories.find(c => c.name === categoryName)?.score || 0
      );
      const avg = categoryScores.reduce((a, b) => a + b, 0) / categoryScores.length;
      const variance = categoryScores.reduce((sum, score) => sum + Math.pow(score - avg, 2), 0) / categoryScores.length;
      const stdDev = Math.sqrt(variance);
      const similarity = Math.max(0, 1 - stdDev / 50); // Normalize std dev to 0-1 similarity
      return { similarity, variance };
    };

    // Create links
    const links: Link[] = [];
    const categorySimilarities: CategorySimilarity[] = [];
    
    if (isSingleSource) {
      // For single source, create links from center to each category node
      // showing the strength/centrality of each category
      const centerNode: Node = {
        id: 'center',
        sourceName: sources[0].name,
        category: 'Center',
        score: 100,
        color: 'hsl(180, 70%, 55%)',
        x: width / 2,
        y: height / 2,
        fx: width / 2,
        fy: height / 2,
      };
      nodes.push(centerNode);

      // Create radial links from center to each category
      nodes.forEach(node => {
        if (node.id !== 'center') {
          links.push({
            source: 'center',
            target: node.id,
            strength: node.score / 100, // Link strength based on category score
          });
        }
      });

      // Connect adjacent categories in the circle to show relationships
      for (let i = 0; i < nodes.length - 1; i++) {
        if (nodes[i].id !== 'center' && nodes[(i + 1) % (nodes.length - 1)].id !== 'center') {
          const node1 = nodes[i];
          const node2 = nodes[(i + 1) % (nodes.length - 1)];
          links.push({
            source: node1.id,
            target: node2.id,
            strength: 0.2, // Weaker links between adjacent categories
          });
        }
      }
    } else {
      // Multi-source view: original clustering logic
      // 1. Strong links within same category (cluster nodes by category)
      const categoryNames = Array.from(new Set(nodes.map(n => n.category)));
      
      categoryNames.forEach(categoryName => {
        const categoryNodes = nodes.filter(n => n.category === categoryName);
        const { similarity: catSimilarity, variance } = calculateCategorySimilarity(categoryName);
        
        // Store category similarity metrics
        let interpretation: 'high' | 'moderate' | 'low';
        if (catSimilarity > 0.75) interpretation = 'high';
        else if (catSimilarity > 0.5) interpretation = 'moderate';
        else interpretation = 'low';
        
        categorySimilarities.push({
          name: categoryName,
          similarity: catSimilarity,
          variance,
          interpretation,
        });
        
        for (let i = 0; i < categoryNodes.length; i++) {
          for (let j = i + 1; j < categoryNodes.length; j++) {
            links.push({
              source: categoryNodes[i].id,
              target: categoryNodes[j].id,
              strength: 0.7 + catSimilarity * 0.2, // 0.7-0.9 range
            });
          }
        }
      });

      // 2. Medium links for same source across categories (show source's fingerprint)
      sources.forEach(source => {
        const sourceNodes = nodes.filter(n => n.sourceName === source.name);
        for (let i = 0; i < sourceNodes.length; i++) {
          for (let j = i + 1; j < sourceNodes.length; j++) {
            // Link strength based on both scores being high (both categories are central to this source)
            const avgScore = (sourceNodes[i].score + sourceNodes[j].score) / 200; // Normalize to 0-1
            links.push({
              source: sourceNodes[i].id,
              target: sourceNodes[j].id,
              strength: avgScore * 0.5, // 0-0.5 range
            });
          }
        }
      });

      // 3. Weak links between different sources in same category (show comparative differences)
      categoryNames.forEach(categoryName => {
        const categoryNodes = nodes.filter(n => n.category === categoryName);
        const sourceGroups = sources.map(s => ({
          name: s.name,
          node: categoryNodes.find(n => n.sourceName === s.name)
        })).filter(g => g.node);

        for (let i = 0; i < sourceGroups.length; i++) {
          for (let j = i + 1; j < sourceGroups.length; j++) {
            if (sourceGroups[i].node && sourceGroups[j].node) {
              const scoreDiff = Math.abs(sourceGroups[i].node!.score - sourceGroups[j].node!.score);
              const similarity = Math.max(0, 1 - scoreDiff / 100);
              if (similarity > 0.3) {
                links.push({
                  source: sourceGroups[i].node!.id,
                  target: sourceGroups[j].node!.id,
                  strength: similarity * 0.2, // 0-0.2 range
                });
              }
            }
          }
        }
      });
    }

    // Calculate comprehensive similarity metrics
    const avgSim = links.reduce((sum, link) => sum + link.strength, 0) / links.length;
    
    // Calculate pairwise source similarities (only for multi-source)
    const sourcePairs: SourcePairSimilarity[] = [];
    if (!isSingleSource) {
      for (let i = 0; i < sources.length; i++) {
        for (let j = i + 1; j < sources.length; j++) {
          const similarity = calculateSourceSimilarity(sources[i], sources[j]);
          sourcePairs.push({
            source1: sources[i].name,
            source2: sources[j].name,
            similarity: similarity,
          });
        }
      }
    }
    
    // Sort to find most/least similar pairs
    sourcePairs.sort((a, b) => b.similarity - a.similarity);
    
    // Find dominant and distinctive categories
    const sortedCategories = [...(isSingleSource ? [] : categorySimilarities)].sort((a, b) => b.similarity - a.similarity);
    const dominantCategory = sortedCategories[0]?.name;
    const distinctiveCategory = sortedCategories[sortedCategories.length - 1]?.name;
    
    setSimilarityMetrics({
      overall: Math.round(avgSim * 100),
      byCategory: isSingleSource ? [] : categorySimilarities,
      sourcePairs: sourcePairs.slice(0, 5), // Top 5 pairs
      dominantCategory,
      distinctiveCategory,
    });

    // Create SVG container
    const svg = d3.select(svgRef.current)
      .attr("width", width)
      .attr("height", height);

    // Add gradient definitions for glow effects
    const defs = svg.append("defs");
    Object.entries(categoryColors).forEach(([category, color]) => {
      const gradient = defs.append("radialGradient")
        .attr("id", `glow-${category.replace(/\s+/g, '-')}`);
      
      gradient.append("stop")
        .attr("offset", "0%")
        .attr("stop-color", color)
        .attr("stop-opacity", 0.8);
      
      gradient.append("stop")
        .attr("offset", "100%")
        .attr("stop-color", color)
        .attr("stop-opacity", 0);
    });

    // Create force simulation (only for multi-source view)
    const simulation = !isSingleSource ? d3.forceSimulation(nodes as d3.SimulationNodeDatum[])
      .force("link", d3.forceLink(links)
        .id((d: any) => d.id)
        .distance((d: any) => {
          if (d.strength > 0.6) return 50;
          if (d.strength > 0.3) return 100;
          return 180;
        })
        .strength((d: any) => d.strength))
      .force("charge", d3.forceManyBody()
        .strength(-250)
        .distanceMax(400))
      .force("center", d3.forceCenter(width / 2, height / 2))
      .force("collision", d3.forceCollide()
        .radius((d: any) => 12 + (d.score / 100) * 28)
        .strength(0.9))
      .force("cluster", () => {
        const clusterCenters: Record<string, { x: number; y: number; count: number }> = {};
        
        nodes.forEach(node => {
          if (!clusterCenters[node.category]) {
            clusterCenters[node.category] = { x: 0, y: 0, count: 0 };
          }
          if (node.x !== undefined && node.y !== undefined) {
            clusterCenters[node.category].x += node.x;
            clusterCenters[node.category].y += node.y;
            clusterCenters[node.category].count += 1;
          }
        });

        nodes.forEach(node => {
          const cluster = clusterCenters[node.category];
          if (cluster && cluster.count > 0 && node.x !== undefined && node.y !== undefined) {
            const centerX = cluster.x / cluster.count;
            const centerY = cluster.y / cluster.count;
            const dx = centerX - node.x;
            const dy = centerY - node.y;
            const strength = 0.15;
            node.x += dx * strength;
            node.y += dy * strength;
          }
        });
      }) : null;

    // Draw links
    const link = svg.append("g")
      .selectAll("line")
      .data(links)
      .join("line")
      .attr("stroke", (d) => {
        if (d.strength > 0.6) return "hsl(180, 65%, 52%)";
        if (d.strength > 0.3) return "hsl(180, 50%, 45%)";
        return "hsl(180, 35%, 38%)";
      })
      .attr("stroke-opacity", (d) => {
        if (d.strength > 0.6) return 0.6;
        if (d.strength > 0.3) return 0.3;
        return 0.12;
      })
      .attr("stroke-width", (d) => {
        if (d.strength > 0.6) return 3;
        if (d.strength > 0.3) return 1.8;
        return 0.9;
      });

    // Draw glow circles behind nodes
    const glowCircles = svg.append("g")
      .selectAll("circle")
      .data(nodes)
      .join("circle")
      .attr("r", (d) => 24 + (d.score / 100) * 42)
      .attr("fill", (d) => `url(#glow-${d.category.replace(/\s+/g, '-')})`)
      .attr("opacity", 0.5);

    // Draw nodes - SIZE REPRESENTS CATEGORY SCORE FOR THAT SOURCE
    const node = svg.append("g")
      .selectAll("circle")
      .data(nodes)
      .join("circle")
      .attr("r", (d) => 10 + (d.score / 100) * 25) // Score drives node size
      .attr("fill", (d) => d.color)
      .attr("opacity", 0.8)
      .attr("stroke", "none")
      .style("cursor", "pointer")
      .on("mouseenter", (event, d) => {
        setHoveredNode(`${d.sourceName} - ${d.category}: ${d.score}%`);
        d3.select(event.currentTarget)
          .transition()
          .duration(200)
          .attr("r", (d: any) => 15 + (d.score / 100) * 30)
          .attr("opacity", 1);
      })
      .on("mouseleave", (event, d) => {
        setHoveredNode(null);
        d3.select(event.currentTarget)
          .transition()
          .duration(200)
          .attr("r", (d: any) => 10 + (d.score / 100) * 25)
          .attr("opacity", 0.8);
      });

    // Only add drag behavior if simulation exists (multi-source view)
    if (simulation) {
      node.call(d3.drag<SVGCircleElement, Node>()
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
        }));
    }

    // Update positions on simulation tick (only if simulation exists)
    if (simulation) {
      simulation.on("tick", () => {
        link
          .attr("x1", (d: any) => d.source.x)
          .attr("y1", (d: any) => d.source.y)
          .attr("x2", (d: any) => d.target.x)
          .attr("y2", (d: any) => d.target.y);

        node
          .attr("cx", (d: any) => d.x)
          .attr("cy", (d: any) => d.y);

        glowCircles
          .attr("cx", (d: any) => d.x)
          .attr("cy", (d: any) => d.y);
      });
    } else {
      // For single-source (no simulation), just set positions from fixed coords
      link
        .attr("x1", (d: any) => d.source.x || 0)
        .attr("y1", (d: any) => d.source.y || 0)
        .attr("x2", (d: any) => d.target.x || 0)
        .attr("y2", (d: any) => d.target.y || 0);

      node
        .attr("cx", (d: any) => d.x || 0)
        .attr("cy", (d: any) => d.y || 0);

      glowCircles
        .attr("cx", (d: any) => d.x || 0)
        .attr("cy", (d: any) => d.y || 0);
    }

    return () => {
      simulation?.stop();
    };
  }, [sources]);

  return (
    <Card className="relative overflow-hidden bg-card/80 backdrop-blur-sm shadow-elegant border-border/50">
      <div className="p-6">
        <div className="mb-4 relative">
          {/* SAM Logo - Top Left Corner */}
          <div className="absolute -top-6 -left-6 w-28 h-28 z-10 pointer-events-none">
            <div
              className="relative w-full h-full rounded-full p-[2px]"
              style={{
                background:
                  "linear-gradient(135deg, hsl(200 85% 55%), hsl(180 80% 60%), hsl(160 75% 50%))",
                boxShadow:
                  "0 0 16px hsl(180 80% 60% / 0.9), 0 0 36px hsl(180 80% 60% / 0.45)",
              }}
            >
              <div className="w-full h-full rounded-full overflow-hidden relative"
                   style={{ backgroundColor: 'rgba(0, 0, 0, 0.85)' }}>
                <img
                  src={samLogo}
                  alt="SAM - Sonic Assignment Machine"
                  className="w-full h-full object-contain rounded-full"
                  style={{
                    mixBlendMode: "screen",
                    filter: "brightness(1.1) contrast(1.15)",
                    WebkitMaskImage:
                      "radial-gradient(circle at center, rgba(0,0,0,1) 72%, rgba(0,0,0,0) 100%)",
                    maskImage:
                      "radial-gradient(circle at center, rgba(0,0,0,1) 72%, rgba(0,0,0,0) 100%)",
                  }}
                />
              </div>
            </div>
          </div>

          <div className="ml-24">
            <h3 className="text-lg font-semibold text-foreground">
              {sources.length === 1 ? 'Ontological Fingerprint' : 'Ontological Identity Network'}
            </h3>
            <p className="text-sm text-muted-foreground">
              {sources.length === 1 
                ? 'Radial view showing category centrality to source identity • Line thickness = score strength'
                : 'Natural clustering shows category proximity • Node size = category prevalence strength • Blue-green spectrum'}
            </p>
          </div>
        </div>
        <div className="relative h-[500px] rounded-lg bg-black border border-border/30 overflow-hidden">
          {/* Background images */}
          {sourceImages.length > 0 && (
            <div className="absolute inset-0 flex items-center justify-center">
              {sourceImages.map((source, index) => (
                <img
                  key={source.name}
                  src={source.imageUrl}
                  alt={source.name}
                  className="absolute w-64 h-64 object-cover opacity-30 blur-sm"
                  style={{
                    transform: `translate(${(index % 3 - 1) * 150}px, ${Math.floor(index / 3) * 150 - 100}px) rotate(${index * 15}deg)`,
                    filter: 'grayscale(30%) brightness(0.7)',
                    mixBlendMode: 'screen',
                  }}
                />
              ))}
            </div>
          )}
          <svg
            ref={svgRef}
            className="w-full h-full relative z-10"
            style={{ background: "transparent" }}
          />
          
          {/* Enhanced Similarity Metrics - Bottom Left */}
          <div className="absolute bottom-4 left-4 bg-card/95 backdrop-blur-md border border-primary/20 rounded-lg p-4 shadow-lg z-20 max-w-[400px]">
            <div className="flex items-center justify-between mb-3">
              <div className="text-xs font-semibold text-foreground">SAM-Based Similarity</div>
              {sources.length > 1 && (
                <button
                  onClick={() => setShowDetails(!showDetails)}
                  className="text-[10px] text-primary hover:text-primary/80 transition-colors px-2 py-1 bg-primary/10 rounded"
                >
                  {showDetails ? 'Hide Details' : 'View Details'}
                </button>
              )}
            </div>
            
            {/* Overall Score */}
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

            {/* Detailed Breakdown - Only for multi-source */}
            {showDetails && sources.length > 1 && (
              <div className="mt-4 pt-4 border-t border-border/30 space-y-3 max-h-[300px] overflow-y-auto">
                {/* Category-Level Breakdown */}
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

                {/* Source Pair Similarities */}
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

                {/* Key Insights */}
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
          
          {/* Category Legend - Bottom Right */}
          <div className="absolute bottom-4 right-4 bg-card/95 backdrop-blur-md border border-primary/20 rounded-lg p-3 shadow-lg z-20">
            <div className="text-xs font-semibold text-foreground mb-2">Category Legend</div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
              {Object.entries({
                'Emotional': 'hsl(200, 85%, 55%)',
                'Cognitive': 'hsl(160, 75%, 50%)',
                'Social': 'hsl(180, 80%, 60%)',
                'Communication': 'hsl(140, 70%, 55%)',
                'Contextual': 'hsl(220, 75%, 60%)',
                'Artistic': 'hsl(170, 80%, 55%)',
              }).map(([category, color]) => (
                <div key={category} className="flex items-center gap-1.5">
                  {category === 'Emotional' ? (
                    <div
                      className="h-2.5 w-2.5"
                      style={{
                        backgroundColor: color,
                        WebkitMaskImage: `url(${emotionIcon})`,
                        WebkitMaskSize: 'contain',
                        WebkitMaskPosition: 'center',
                        WebkitMaskRepeat: 'no-repeat',
                        maskImage: `url(${emotionIcon})`,
                        maskSize: 'contain',
                        maskPosition: 'center',
                        maskRepeat: 'no-repeat',
                      }}
                    />
                  ) : category === 'Social' ? (
                    <div
                      className="h-2.5 w-2.5"
                      style={{
                        backgroundColor: color,
                        WebkitMask: `url(${socialIcon}) center / contain no-repeat`,
                        mask: `url(${socialIcon}) center / contain no-repeat`,
                      }}
                    />
                  ) : (
                    <div
                      className="h-2.5 w-2.5 rounded-full"
                      style={{ backgroundColor: color }}
                    />
                  )}
                  <span className="text-xs text-muted-foreground">{category}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Hover Info */}
          {hoveredNode && (
            <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-card/95 backdrop-blur-md border border-primary/30 rounded-lg px-4 py-2 shadow-lg z-20">
              <div className="text-xs font-semibold text-foreground whitespace-nowrap">
                {hoveredNode}
              </div>
            </div>
          )}
        </div>
      </div>
    </Card>
  );
};