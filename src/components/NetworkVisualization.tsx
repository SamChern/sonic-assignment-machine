import { useEffect, useRef, useState } from "react";
import * as d3 from "d3";
import { Card } from "@/components/ui/card";

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
}

export const NetworkVisualization = ({ categories }: NetworkVisualizationProps) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);

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

    // Create nodes: one for each source-category combination
    const nodes: Node[] = [];
    sources.forEach(sourceName => {
      categories.forEach(category => {
        // Check if this category applies to this source
        const sourceInCategory = category.sources?.some(s => s.name === sourceName);
        if (sourceInCategory) {
          nodes.push({
            id: `${sourceName}::${category.name}`,
            name: sourceName,
            category: category.name,
            confidence: category.confidence,
            color: categoryColors[category.name] || 'hsl(180, 70%, 55%)',
          });
        }
      });
    });

    // Create links between nodes of the same source (different categories)
    const links: Link[] = [];
    sources.forEach(sourceName => {
      const sourceNodes = nodes.filter(n => n.name === sourceName);
      for (let i = 0; i < sourceNodes.length; i++) {
        for (let j = i + 1; j < sourceNodes.length; j++) {
          const confidenceDiff = Math.abs(sourceNodes[i].confidence - sourceNodes[j].confidence);
          const strength = Math.max(0.3, 1 - confidenceDiff / 100);
          links.push({
            source: sourceNodes[i].id,
            target: sourceNodes[j].id,
            strength,
          });
        }
      }
    });

    // Also create weaker links between same categories across different sources
    categories.forEach(category => {
      const categoryNodes = nodes.filter(n => n.category === category.name);
      for (let i = 0; i < categoryNodes.length; i++) {
        for (let j = i + 1; j < categoryNodes.length; j++) {
          links.push({
            source: categoryNodes[i].id,
            target: categoryNodes[j].id,
            strength: 0.2,
          });
        }
      }
    });

    // Create SVG container
    const svg = d3.select(svgRef.current)
      .attr("width", width)
      .attr("height", height);

    // Add gradient definitions for glow effects
    const defs = svg.append("defs");
    Object.entries(categoryColors).forEach(([category, color], i) => {
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

    // Create force simulation with stronger clustering
    const simulation = d3.forceSimulation(nodes as d3.SimulationNodeDatum[])
      .force("link", d3.forceLink(links)
        .id((d: any) => d.id)
        .distance((d: any) => d.strength > 0.5 ? 80 : 150)
        .strength((d: any) => d.strength))
      .force("charge", d3.forceManyBody().strength(-300))
      .force("center", d3.forceCenter(width / 2, height / 2))
      .force("collision", d3.forceCollide().radius((d: any) => 15 + (d.confidence / 100) * 25))
      .force("x", d3.forceX(width / 2).strength(0.05))
      .force("y", d3.forceY(height / 2).strength(0.05));

    // Draw links
    const link = svg.append("g")
      .selectAll("line")
      .data(links)
      .join("line")
      .attr("stroke", "hsl(180, 40%, 40%)")
      .attr("stroke-opacity", (d) => d.strength * 0.3)
      .attr("stroke-width", (d) => d.strength * 1.5);

    // Draw glow circles behind nodes
    const glowCircles = svg.append("g")
      .selectAll("circle")
      .data(nodes)
      .join("circle")
      .attr("r", (d) => 20 + (d.confidence / 100) * 35)
      .attr("fill", (d) => `url(#glow-${d.category.replace(/\s+/g, '-')})`)
      .attr("opacity", 0.6);

    // Draw nodes - size represents category strength/identity
    const node = svg.append("g")
      .selectAll("circle")
      .data(nodes)
      .join("circle")
      .attr("r", (d) => 10 + (d.confidence / 100) * 20) // Node size based on confidence
      .attr("fill", (d) => d.color)
      .attr("stroke", "hsl(0, 0%, 10%)")
      .attr("stroke-width", 2)
      .style("cursor", "pointer")
      .on("mouseenter", (event, d) => {
        setHoveredNode(`${d.name} - ${d.category}: ${d.confidence}%`);
        d3.select(event.currentTarget)
          .transition()
          .duration(200)
          .attr("r", (d: any) => 15 + (d.confidence / 100) * 25);
      })
      .on("mouseleave", (event, d) => {
        setHoveredNode(null);
        d3.select(event.currentTarget)
          .transition()
          .duration(200)
          .attr("r", (d: any) => 10 + (d.confidence / 100) * 20);
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

    // Add category labels (only show when hovered or for larger nodes)
    const labels = svg.append("g")
      .selectAll("text")
      .data(nodes.filter(n => n.confidence > 70))
      .join("text")
      .attr("text-anchor", "middle")
      .attr("dy", (d) => 30 + (d.confidence / 100) * 25)
      .attr("fill", "hsl(0, 0%, 90%)")
      .attr("font-size", "10px")
      .attr("font-weight", "600")
      .attr("pointer-events", "none")
      .style("text-shadow", "0 0 3px rgba(0,0,0,0.8)")
      .text((d) => d.category);

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

      labels
        .attr("x", (d: any) => d.x)
        .attr("y", (d: any) => d.y);
    });

    return () => {
      simulation.stop();
    };
  }, [categories]);

  return (
    <Card className="relative overflow-hidden bg-card/80 backdrop-blur-sm shadow-elegant border-border/50">
      <div className="p-6">
        <div className="mb-4">
          <h3 className="text-lg font-semibold text-foreground">Ontological Identity Network</h3>
          <p className="text-sm text-muted-foreground">
            Node size represents category strength • Each source has 6 category nodes • Blue-green spectrum
          </p>
        </div>
        <div className="relative h-[500px] rounded-lg bg-black border border-border/30">
          <svg
            ref={svgRef}
            className="w-full h-full"
            style={{ background: "transparent" }}
          />
          {hoveredNode && (
            <div className="absolute bottom-4 left-4 right-4 p-3 rounded-lg bg-card/95 border border-primary/30 backdrop-blur-sm">
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
