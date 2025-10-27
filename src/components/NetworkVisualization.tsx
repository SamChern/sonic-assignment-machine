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

    // Color palette matching the app theme
    const colors = [
      "hsl(220, 70%, 60%)",  // Primary blue
      "hsl(190, 80%, 60%)",  // Cyan
      "hsl(260, 70%, 60%)",  // Purple
      "hsl(340, 70%, 60%)",  // Pink
      "hsl(160, 70%, 50%)",  // Teal
    ];

    // Create nodes from categories
    const nodes: Node[] = categories.map((cat, i) => ({
      id: cat.name,
      name: cat.name,
      category: cat.name.toLowerCase(),
      confidence: cat.confidence,
      color: colors[i % colors.length],
    }));

    // Create links between nodes based on confidence similarity
    const links: Link[] = [];
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const confidenceDiff = Math.abs(nodes[i].confidence - nodes[j].confidence);
        const strength = Math.max(0.2, 1 - confidenceDiff / 100);
        links.push({
          source: nodes[i].id,
          target: nodes[j].id,
          strength,
        });
      }
    }

    // Create SVG container
    const svg = d3.select(svgRef.current)
      .attr("width", width)
      .attr("height", height);

    // Add gradient definitions for glow effects
    const defs = svg.append("defs");
    colors.forEach((color, i) => {
      const gradient = defs.append("radialGradient")
        .attr("id", `glow-${i}`);
      
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
        .distance(150)
        .strength((d: any) => d.strength))
      .force("charge", d3.forceManyBody().strength(-400))
      .force("center", d3.forceCenter(width / 2, height / 2))
      .force("collision", d3.forceCollide().radius(50));

    // Draw links
    const link = svg.append("g")
      .selectAll("line")
      .data(links)
      .join("line")
      .attr("stroke", "hsl(220, 20%, 40%)")
      .attr("stroke-opacity", (d) => d.strength * 0.3)
      .attr("stroke-width", (d) => d.strength * 2);

    // Draw glow circles behind nodes
    const glowCircles = svg.append("g")
      .selectAll("circle")
      .data(nodes)
      .join("circle")
      .attr("r", (d) => 30 + (d.confidence / 100) * 20)
      .attr("fill", (d, i) => `url(#glow-${i})`)
      .attr("opacity", 0.6);

    // Draw nodes
    const node = svg.append("g")
      .selectAll("circle")
      .data(nodes)
      .join("circle")
      .attr("r", (d) => 15 + (d.confidence / 100) * 10)
      .attr("fill", (d, i) => colors[i])
      .attr("stroke", "#fff")
      .attr("stroke-width", 2)
      .style("cursor", "pointer")
      .on("mouseenter", (event, d) => {
        setHoveredNode(d.id);
        d3.select(event.currentTarget)
          .transition()
          .duration(200)
          .attr("r", (d: any) => 20 + (d.confidence / 100) * 15);
      })
      .on("mouseleave", (event, d) => {
        setHoveredNode(null);
        d3.select(event.currentTarget)
          .transition()
          .duration(200)
          .attr("r", (d: any) => 15 + (d.confidence / 100) * 10);
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

    // Add labels
    const labels = svg.append("g")
      .selectAll("text")
      .data(nodes)
      .join("text")
      .attr("text-anchor", "middle")
      .attr("dy", (d) => 30 + (d.confidence / 100) * 15)
      .attr("fill", "#fff")
      .attr("font-size", "12px")
      .attr("font-weight", "600")
      .attr("pointer-events", "none")
      .text((d) => d.name);

    // Add confidence labels
    const confidenceLabels = svg.append("g")
      .selectAll("text")
      .data(nodes)
      .join("text")
      .attr("text-anchor", "middle")
      .attr("dy", (d) => 45 + (d.confidence / 100) * 15)
      .attr("fill", "hsl(220, 15%, 70%)")
      .attr("font-size", "10px")
      .attr("pointer-events", "none")
      .text((d) => `${d.confidence}%`);

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

      confidenceLabels
        .attr("x", (d: any) => d.x)
        .attr("y", (d: any) => d.y);
    });

    return () => {
      simulation.stop();
    };
  }, [categories]);

  return (
    <Card className="relative overflow-hidden bg-gradient-to-br from-card to-muted/20 shadow-elegant">
      <div className="p-6">
        <div className="mb-4">
          <h3 className="text-lg font-semibold text-foreground">Category Network</h3>
          <p className="text-sm text-muted-foreground">
            Interactive visualization of categorical connections
          </p>
        </div>
        <div className="relative h-[500px] rounded-lg bg-gradient-to-br from-background/50 to-muted/10 border border-border">
          <svg
            ref={svgRef}
            className="w-full h-full"
            style={{ background: "transparent" }}
          />
          {hoveredNode && (
            <div className="absolute bottom-4 left-4 right-4 p-3 rounded-lg bg-card/90 border border-border backdrop-blur-sm">
              <p className="text-sm font-medium text-foreground">
                Drag nodes to explore connections • Hover for details
              </p>
            </div>
          )}
        </div>
      </div>
    </Card>
  );
};
