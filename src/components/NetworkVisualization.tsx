import { useEffect, useRef, useState } from "react";
import * as d3 from "d3";
import { Card } from "@/components/ui/card";
import samLogo from "@/assets/sam-logo.png";

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

interface NetworkVisualizationProps {
  sources: SourceAnalysis[];
  sourceImages?: Array<{ name: string; imageUrl: string }>;
}

export const NetworkVisualization = ({ sources, sourceImages = [] }: NetworkVisualizationProps) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const [avgSimilarity, setAvgSimilarity] = useState<number>(0);

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
    const calculateCategorySimilarity = (categoryName: string): number => {
      const categoryScores = sources.map(s => 
        s.categories.find(c => c.name === categoryName)?.score || 0
      );
      const avg = categoryScores.reduce((a, b) => a + b, 0) / categoryScores.length;
      const variance = categoryScores.reduce((sum, score) => sum + Math.pow(score - avg, 2), 0) / categoryScores.length;
      const stdDev = Math.sqrt(variance);
      return Math.max(0, 1 - stdDev / 50); // Normalize std dev to 0-1 similarity
    };

    // Create links
    const links: Link[] = [];
    
    // 1. Strong links within same category (cluster nodes by category)
    const categoryNames = Array.from(new Set(nodes.map(n => n.category)));
    categoryNames.forEach(categoryName => {
      const categoryNodes = nodes.filter(n => n.category === categoryName);
      const catSimilarity = calculateCategorySimilarity(categoryName);
      
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

    // Calculate average similarity for display
    const avgSim = links.reduce((sum, link) => sum + link.strength, 0) / links.length * 100;
    setAvgSimilarity(Math.round(avgSim));

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

    // Create force simulation
    const simulation = d3.forceSimulation(nodes as d3.SimulationNodeDatum[])
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
      });

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
      })
      .call(d3.drag<SVGCircleElement, Node>()
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

    // Update positions on simulation tick
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

    return () => {
      simulation.stop();
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
            <h3 className="text-lg font-semibold text-foreground">Ontological Identity Network</h3>
            <p className="text-sm text-muted-foreground">
              Per-source comparative scoring • Node size = category centrality to source identity • Blue-green spectrum
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
          
          {/* Similarity Metric - Bottom Left */}
          <div className="absolute bottom-4 left-4 bg-card/95 backdrop-blur-md border border-primary/20 rounded-lg p-4 shadow-lg z-20 min-w-[240px]">
            <div className="text-xs font-semibold text-foreground mb-3">Ontological Alignment</div>
            
            <div className="relative h-6 rounded-full overflow-hidden border border-border/30 mb-2">
              <div 
                className="h-full transition-all duration-500 ease-out"
                style={{
                  width: `${avgSimilarity}%`,
                  background: `linear-gradient(90deg, 
                    hsl(140, 70%, 45%), 
                    hsl(170, 80%, 55%), 
                    hsl(200, 85%, 60%)
                  )`
                }}
              />
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="text-xs font-bold text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)]">
                  {avgSimilarity}%
                </span>
              </div>
            </div>
            
            <div className="mt-3 pt-2 border-t border-border/30">
              <div className="text-[10px] text-muted-foreground">
                {avgSimilarity > 60 ? '🟢 High cross-source similarity' :
                 avgSimilarity > 35 ? '🟡 Moderate differentiation' :
                 '🔴 Highly distinct profiles'}
              </div>
            </div>
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
                  <div
                    className="h-2.5 w-2.5 rounded-full"
                    style={{ backgroundColor: color }}
                  />
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