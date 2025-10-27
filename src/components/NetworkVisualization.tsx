import { useEffect, useRef, useState } from "react";
import * as d3 from "d3";
import { Card } from "@/components/ui/card";
import samLogo from "@/assets/sam-logo.png";

interface Node {
  id: string;
  name: string;
  category: string;
  confidence: number;
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

interface NetworkVisualizationProps {
  categories: Array<{
    name: string;
    confidence: number;
    description: string;
    sources?: Array<{ name: string; type: string }>;
  }>;
  sourceImages?: Array<{ name: string; imageUrl: string }>;
}

export const NetworkVisualization = ({ categories, sourceImages = [] }: NetworkVisualizationProps) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const [connectionStrength, setConnectionStrength] = useState<number>(0);

  useEffect(() => {
    if (!svgRef.current || !categories.length) return;

    const width = svgRef.current.clientWidth;
    const height = svgRef.current.clientHeight;

    // Clear previous content
    d3.select(svgRef.current).selectAll("*").remove();

    // Blue and green gradient color palette for categories
    const categoryColors: Record<string, string> = {
      'Emotional': 'hsl(200, 85%, 55%)',      // Sky blue
      'Cognitive': 'hsl(160, 75%, 50%)',      // Teal green
      'Social': 'hsl(180, 80%, 60%)',         // Cyan
      'Communication': 'hsl(140, 70%, 55%)',  // Green
      'Contextual': 'hsl(220, 75%, 60%)',     // Deep blue
      'Artistic': 'hsl(170, 80%, 55%)',       // Turquoise
    };

    // Collect all unique sources from all categories
    const allSources = new Set<string>();
    categories.forEach(cat => {
      cat.sources?.forEach(source => {
        allSources.add(source.name);
      });
    });

    const sources = Array.from(allSources);

    // Calculate overall connection strength
    const calculateConnectionStrength = () => {
      if (sources.length <= 1) return 100;
      
      // Calculate average confidence variance across categories
      const categoryVariances = categories.map(cat => {
        const sourceCount = cat.sources?.length || 0;
        return (sourceCount / sources.length) * cat.confidence;
      });
      
      const avgVariance = categoryVariances.reduce((a, b) => a + b, 0) / categories.length;
      return Math.min(100, Math.max(0, avgVariance));
    };

    const strength = calculateConnectionStrength();
    setConnectionStrength(strength);

    // Create nodes: one for each source-category combination
    const nodes: Node[] = [];
    categories.forEach((category) => {
      category.sources?.forEach(source => {
        nodes.push({
          id: `${source.name}::${category.name}`,
          name: source.name,
          category: category.name,
          confidence: category.confidence, // This drives node size
          color: categoryColors[category.name] || 'hsl(180, 70%, 55%)',
        });
      });
    });

    // Calculate category similarity based on confidence patterns
    const categorySimilarity: Record<string, Record<string, number>> = {};
    categories.forEach(cat1 => {
      categorySimilarity[cat1.name] = {};
      categories.forEach(cat2 => {
        if (cat1.name !== cat2.name) {
          // Similarity based on confidence difference
          const diff = Math.abs(cat1.confidence - cat2.confidence);
          categorySimilarity[cat1.name][cat2.name] = Math.max(0, 1 - diff / 100);
        }
      });
    });

    // Create links
    const links: Link[] = [];
    
    // 1. Strong links within same category (cluster files by category)
    categories.forEach(category => {
      const categoryNodes = nodes.filter(n => n.category === category.name);
      for (let i = 0; i < categoryNodes.length; i++) {
        for (let j = i + 1; j < categoryNodes.length; j++) {
          links.push({
            source: categoryNodes[i].id,
            target: categoryNodes[j].id,
            strength: 0.9, // Very strong intra-category links
          });
        }
      }
    });

    // 2. Medium links for same source across categories (show cross-category relationships)
    sources.forEach(sourceName => {
      const sourceNodes = nodes.filter(n => n.name === sourceName);
      for (let i = 0; i < sourceNodes.length; i++) {
        for (let j = i + 1; j < sourceNodes.length; j++) {
          const cat1 = sourceNodes[i].category;
          const cat2 = sourceNodes[j].category;
          const similarity = categorySimilarity[cat1]?.[cat2] || 0.3;
          links.push({
            source: sourceNodes[i].id,
            target: sourceNodes[j].id,
            strength: similarity * 0.4, // Medium strength based on category similarity
          });
        }
      }
    });

    // 3. Weak links between different sources in similar categories (show category proximity)
    for (let i = 0; i < categories.length; i++) {
      for (let j = i + 1; j < categories.length; j++) {
        const cat1Nodes = nodes.filter(n => n.category === categories[i].name);
        const cat2Nodes = nodes.filter(n => n.category === categories[j].name);
        const similarity = categorySimilarity[categories[i].name]?.[categories[j].name] || 0;
        
        // Create a few representative links between category clusters
        if (similarity > 0.5 && cat1Nodes.length > 0 && cat2Nodes.length > 0) {
          links.push({
            source: cat1Nodes[0].id,
            target: cat2Nodes[0].id,
            strength: similarity * 0.15, // Weak inter-category links
          });
        }
      }
    }

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

    // Create force simulation with natural clustering
    const simulation = d3.forceSimulation(nodes as d3.SimulationNodeDatum[])
      .force("link", d3.forceLink(links)
        .id((d: any) => d.id)
        .distance((d: any) => {
          // Shorter distance for stronger links (same category)
          if (d.strength > 0.7) return 50;
          if (d.strength > 0.3) return 120;
          return 200;
        })
        .strength((d: any) => d.strength))
      .force("charge", d3.forceManyBody()
        .strength(-200)
        .distanceMax(300))
      .force("center", d3.forceCenter(width / 2, height / 2))
      .force("collision", d3.forceCollide()
        .radius((d: any) => 15 + (d.confidence / 100) * 25)
        .strength(0.8))
      // Add clustering force based on category
      .force("cluster", () => {
        const categoryList = Array.from(new Set(categories.map(c => c.name)));
        const clusterCenters: Record<string, { x: number; y: number; count: number }> = {};
        
        // Calculate cluster centers
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

        // Apply clustering force
        nodes.forEach(node => {
          const cluster = clusterCenters[node.category];
          if (cluster && cluster.count > 0 && node.x !== undefined && node.y !== undefined) {
            const centerX = cluster.x / cluster.count;
            const centerY = cluster.y / cluster.count;
            const dx = centerX - node.x;
            const dy = centerY - node.y;
            const strength = 0.1;
            node.x += dx * strength;
            node.y += dy * strength;
          }
        });
      });

    // Draw links with varying opacity based on strength
    const link = svg.append("g")
      .selectAll("line")
      .data(links)
      .join("line")
      .attr("stroke", (d) => {
        if (d.strength > 0.7) return "hsl(180, 60%, 50%)";
        if (d.strength > 0.3) return "hsl(180, 45%, 42%)";
        return "hsl(180, 30%, 35%)";
      })
      .attr("stroke-opacity", (d) => {
        if (d.strength > 0.7) return 0.5;
        if (d.strength > 0.3) return 0.25;
        return 0.1;
      })
      .attr("stroke-width", (d) => {
        if (d.strength > 0.7) return 2.5;
        if (d.strength > 0.3) return 1.5;
        return 0.8;
      });

    // Draw glow circles behind nodes
    const glowCircles = svg.append("g")
      .selectAll("circle")
      .data(nodes)
      .join("circle")
      .attr("r", (d) => 22 + (d.confidence / 100) * 38)
      .attr("fill", (d) => `url(#glow-${d.category.replace(/\s+/g, '-')})`)
      .attr("opacity", 0.5);

    // Draw nodes - SIZE REPRESENTS CATEGORY STRENGTH/PREVALENCE FOR THAT SOURCE
    const node = svg.append("g")
      .selectAll("circle")
      .data(nodes)
      .join("circle")
      .attr("r", (d) => 8 + (d.confidence / 100) * 22) // Confidence drives node size
      .attr("fill", (d) => d.color)
      .attr("stroke", "hsl(0, 0%, 10%)")
      .attr("stroke-width", 2.5)
      .style("cursor", "pointer")
      .on("mouseenter", (event, d) => {
        setHoveredNode(`${d.name} - ${d.category}: ${d.confidence}%`);
        d3.select(event.currentTarget)
          .transition()
          .duration(200)
          .attr("r", (d: any) => 13 + (d.confidence / 100) * 27)
          .attr("stroke-width", 4);
      })
      .on("mouseleave", (event, d) => {
        setHoveredNode(null);
        d3.select(event.currentTarget)
          .transition()
          .duration(200)
          .attr("r", (d: any) => 8 + (d.confidence / 100) * 22)
          .attr("stroke-width", 2.5);
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
  }, [categories]);

  return (
    <Card className="relative overflow-hidden bg-card/80 backdrop-blur-sm shadow-elegant border-border/50">
      <div className="p-6">
        <div className="mb-4 relative">
          {/* SAM Logo - Top Left */}
          <div className="absolute -top-2 -left-2 w-32 h-16 opacity-70">
            <img 
              src={samLogo} 
              alt="Sonic Assignment Machine" 
              className="w-full h-full object-contain mix-blend-screen"
              style={{
                filter: 'brightness(1.2) contrast(1.1)',
              }}
            />
          </div>
          
          <h3 className="text-lg font-semibold text-foreground">Ontological Identity Network</h3>
          <p className="text-sm text-muted-foreground">
            Natural clustering shows category proximity • Node size = category prevalence strength • Blue-green spectrum
          </p>
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
          
          {/* Connection Strength Visualization - Bottom Left */}
          <div className="absolute bottom-4 left-4 bg-card/95 backdrop-blur-md border border-primary/20 rounded-lg p-4 shadow-lg z-20 min-w-[240px]">
            <div className="text-xs font-semibold text-foreground mb-3">SAM-Based Similarity</div>
            
            {/* Connection strength gradient bar */}
            <div className="relative h-6 rounded-full overflow-hidden border border-border/30 mb-2">
              <div 
                className="h-full transition-all duration-500 ease-out"
                style={{
                  width: `${connectionStrength}%`,
                  background: `linear-gradient(90deg, 
                    hsl(140, 70%, 45%), 
                    hsl(170, 80%, 55%), 
                    hsl(200, 85%, 60%)
                  )`
                }}
              />
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="text-xs font-bold text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)]">
                  {connectionStrength.toFixed(0)}%
                </span>
              </div>
            </div>
            
            {/* Strength indicators */}
            <div className="grid grid-cols-3 gap-2 text-xs mt-3">
              <div className="text-center">
                <div className="w-full h-1.5 rounded-full bg-gradient-to-r from-green-500/40 to-green-500/60 mb-1" />
                <span className="text-muted-foreground text-[10px]">Cross-Source</span>
              </div>
              <div className="text-center">
                <div className="w-full h-1.5 rounded-full bg-gradient-to-r from-cyan-500/40 to-cyan-500/60 mb-1" />
                <span className="text-muted-foreground text-[10px]">Similarity</span>
              </div>
              <div className="text-center">
                <div className="w-full h-1.5 rounded-full bg-gradient-to-r from-blue-500/40 to-blue-500/60 mb-1" />
                <span className="text-muted-foreground text-[10px]">Clustering</span>
              </div>
            </div>
            
            <div className="mt-3 pt-2 border-t border-border/30">
              <div className="text-[10px] text-muted-foreground">
                {connectionStrength > 70 ? '🟢 Strong ontological alignment' :
                 connectionStrength > 40 ? '🟡 Moderate category overlap' :
                 '🔴 Diverse categorical patterns'}
              </div>
            </div>
          </div>
          
          {/* Color-coded legend - Bottom Right */}
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
                <div key={category} className="flex items-center gap-2">
                  <div 
                    className="w-3 h-3 rounded-full border border-black/30 shadow-sm"
                    style={{ backgroundColor: color }}
                  />
                  <span className="text-xs text-muted-foreground font-medium">{category}</span>
                </div>
              ))}
            </div>
          </div>
          
          {/* Hover info */}
          {hoveredNode && (
            <div className="absolute top-4 left-4 right-4 p-3 rounded-lg bg-card/95 border border-primary/30 backdrop-blur-sm">
              <p className="text-sm font-medium text-foreground">
                {hoveredNode}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Drag to reposition • Larger nodes = stronger category identity
              </p>
            </div>
          )}
        </div>
      </div>
    </Card>
  );
};
