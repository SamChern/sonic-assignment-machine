import { useEffect, useRef, useState } from "react";
import { Activity, Tag, EyeOff } from "lucide-react";
import * as d3 from "d3";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import sonicSimLogo from "@/assets/SonicSIM_blend.png";
import { useGraphZoom } from "@/components/graph/useGraphZoom";
import { GraphZoomControls } from "@/components/graph/GraphZoomControls";
import { CategoryLegend } from "@/components/network-graph/CategoryLegend";
import { NodeTooltip } from "@/components/network-graph/NodeTooltip";
import { SimilarityPanel } from "@/components/network-graph/SimilarityPanel";
import {
  CATEGORY_COLORS,
  type SourceAnalysis,
  type CategorySimilarity,
  type SourcePairSimilarity,
  type SimilarityMetrics,
} from "@/components/network-graph/types";

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

interface NetworkVisualizationProps {
  sources: SourceAnalysis[];
  sourceImages?: Array<{ name: string; imageUrl: string }>;
  /** Source name whose ontology nodes should pulse/highlight (driven by "See my SonicSIM"). */
  highlightSourceName?: string | null;
}

// Store nodes reference for fit-to-view calculation
let networkNodesRef: { x?: number; y?: number; score: number }[] = [];

export const NetworkVisualization = ({
  sources,
  sourceImages = [],
  highlightSourceName = null,
}: NetworkVisualizationProps) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const [pinnedNode, setPinnedNode] = useState<string | null>(null);
  const [selectedCategories, setSelectedCategories] = useState<Set<string>>(new Set());
  const [similarityMetrics, setSimilarityMetrics] = useState<SimilarityMetrics>({
    overall: 0,
    byCategory: [],
    sourcePairs: [],
  });
  /** Audioscope-style pulse on the graph nodes (purely visual, CSS driven). */
  const [animateNodes, setAnimateNodes] = useState(false);
  const [showLabels, setShowLabels] = useState(false);

  const { currentZoom, createZoomBehavior, zoomIn, zoomOut, zoomReset, fitToView } = useGraphZoom(svgRef);

  const handleFitToView = () => {
    fitToView(
      networkNodesRef.map((n) => ({ x: n.x, y: n.y, radius: 10 + (n.score / 100) * 25 + 50 })),
      80,
    );
  };

  useEffect(() => {
    if (!svgRef.current || !sources.length) return;

    const width = svgRef.current.clientWidth;
    const height = svgRef.current.clientHeight;

    // Clear previous content
    d3.select(svgRef.current).selectAll("*").remove();

    const categoryColors = CATEGORY_COLORS;

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

    // Main group for all zoomable content
    const mainGroup = svg.append("g").attr("class", "main-group");

    const zoom = createZoomBehavior((transform) => mainGroup.attr("transform", transform.toString()));
    svg.call(zoom);

    // Store nodes reference for fit-to-view
    networkNodesRef = nodes;

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
    const link = mainGroup.append("g")
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
    const glowCircles = mainGroup.append("g")
      .selectAll("circle")
      .data(nodes)
      .join("circle")
      .attr("r", (d) => 24 + (d.score / 100) * 42)
      .attr("fill", (d) => `url(#glow-${d.category.replace(/\s+/g, '-')})`)
      .attr("opacity", (d) => {
        if (selectedCategories.size === 0) return 0.5;
        return selectedCategories.has(d.category) ? 0.5 : 0.1;
      });

    // Draw nodes - SIZE REPRESENTS CATEGORY SCORE FOR THAT SOURCE
    const nodeGroup = mainGroup.append("g").attr("class", "nodes");
    
    const node = nodeGroup
      .selectAll("circle")
      .data(nodes)
      .join("circle")
      .attr("r", (d) => 10 + (d.score / 100) * 25) // Score drives node size
      .attr("fill", (d) => d.color)
      .attr("class", (d) =>
        highlightSourceName && d.sourceName === highlightSourceName ? "as-node-highlight" : null,
      )
      .attr("opacity", (d) => {
        const highlighted = highlightSourceName && d.sourceName === highlightSourceName;
        if (highlightSourceName && !highlighted) return 0.18;
        if (selectedCategories.size === 0) return highlighted ? 1 : 0.8;
        return selectedCategories.has(d.category) ? 0.95 : 0.2;
      })
      .attr("stroke", (d) => {
        if (highlightSourceName && d.sourceName === highlightSourceName) return "#fff";
        if (selectedCategories.size === 0) return "none";
        return selectedCategories.has(d.category) ? "#fff" : "none";
      })
      .attr("stroke-width", (d) =>
        highlightSourceName && d.sourceName === highlightSourceName
          ? 2.5
          : selectedCategories.has(d.category)
            ? 2
            : 0,
      )
      .style("cursor", "pointer")
      .on("mouseenter", (event, d) => {
        // Don't show hover tooltip if a node is pinned
        if (pinnedNode) return;
        
        // Find category description from source data
        const sourceData = sources.find(s => s.name === d.sourceName);
        const categoryData = sourceData?.categories.find(c => c.name === d.category);
        const description = categoryData?.description || '';
        
        // Create rich tooltip content (truncated for hover)
        const tooltipContent = {
          source: d.sourceName,
          category: d.category,
          score: d.score,
          description: description.length > 100 ? description.substring(0, 100) + '...' : description,
          isPinned: false,
        };
        setHoveredNode(JSON.stringify(tooltipContent));
        
        d3.select(event.currentTarget)
          .transition()
          .duration(200)
          .attr("r", (d: any) => 15 + (d.score / 100) * 30)
          .attr("opacity", 1);
      })
      .on("mouseleave", (event, d) => {
        if (pinnedNode) return;
        setHoveredNode(null);
        d3.select(event.currentTarget)
          .transition()
          .duration(200)
          .attr("r", (d: any) => 10 + (d.score / 100) * 25)
          .attr("opacity", (d: any) => {
            if (selectedCategories.size === 0) return 0.8;
            return selectedCategories.has(d.category) ? 0.95 : 0.2;
          });
      })
      .on("click", (event, d) => {
        event.stopPropagation();
        
        // Find category description from source data
        const sourceData = sources.find(s => s.name === d.sourceName);
        const categoryData = sourceData?.categories.find(c => c.name === d.category);
        const description = categoryData?.description || '';
        
        const nodeId = d.id;
        
        if (pinnedNode === nodeId) {
          // Clicking same node unpins it
          setPinnedNode(null);
          setHoveredNode(null);
        } else {
          // Pin new node with full description
          setPinnedNode(nodeId);
          const tooltipContent = {
            source: d.sourceName,
            category: d.category,
            score: d.score,
            description: description, // Full description for pinned
            isPinned: true,
          };
          setHoveredNode(JSON.stringify(tooltipContent));
        }
      });

    // Add node labels - category names and scores
    const labelsGroup = mainGroup.append("g")
      .attr("class", "labels")
      .style("opacity", showLabels ? 1 : 0)
      .style("transition", "opacity 0.3s ease");
    
    // Category label (below node)
    const categoryLabels = labelsGroup
      .selectAll(".category-label")
      .data(nodes.filter(n => n.id !== 'center'))
      .join("text")
      .attr("class", "category-label")
      .attr("text-anchor", "middle")
      .attr("dominant-baseline", "hanging")
      .attr("fill", "hsl(180, 60%, 85%)")
      .attr("font-size", "11px")
      .attr("font-weight", "600")
      .attr("opacity", (d) => {
        if (selectedCategories.size === 0) return 0.9;
        return selectedCategories.has(d.category) ? 1 : 0.3;
      })
      .style("pointer-events", "none")
      .style("text-shadow", "0 1px 3px rgba(0,0,0,0.8), 0 0 8px rgba(0,0,0,0.6)")
      .text((d) => d.category);

    // Score badge (above node)
    const scoreLabels = labelsGroup
      .selectAll(".score-label")
      .data(nodes.filter(n => n.id !== 'center'))
      .join("text")
      .attr("class", "score-label")
      .attr("text-anchor", "middle")
      .attr("dominant-baseline", "auto")
      .attr("fill", "white")
      .attr("font-size", "10px")
      .attr("font-weight", "700")
      .attr("opacity", (d) => {
        if (selectedCategories.size === 0) return 0.85;
        return selectedCategories.has(d.category) ? 1 : 0.2;
      })
      .style("pointer-events", "none")
      .style("text-shadow", "0 1px 2px rgba(0,0,0,0.9)")
      .text((d) => `${d.score}%`);

    // Source name label (smaller, above category) - only for multi-source
    const sourceLabels = !isSingleSource ? labelsGroup
      .selectAll(".source-label")
      .data(nodes.filter(n => n.id !== 'center'))
      .join("text")
      .attr("class", "source-label")
      .attr("text-anchor", "middle")
      .attr("dominant-baseline", "auto")
      .attr("fill", "hsl(180, 50%, 70%)")
      .attr("font-size", "9px")
      .attr("font-weight", "400")
      .attr("opacity", (d) => {
        if (selectedCategories.size === 0) return 0.7;
        return selectedCategories.has(d.category) ? 0.9 : 0.2;
      })
      .style("pointer-events", "none")
      .style("text-shadow", "0 1px 2px rgba(0,0,0,0.8)")
      .text((d) => {
        // Truncate long source names
        const name = d.sourceName;
        return name.length > 20 ? name.substring(0, 18) + '...' : name;
      }) : null;

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

    // Helper function to calculate label offset based on node radius
    const getNodeRadius = (d: Node) => 10 + (d.score / 100) * 25;

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

        // Update label positions
        categoryLabels
          .attr("x", (d: any) => d.x)
          .attr("y", (d: any) => d.y + getNodeRadius(d) + 8);

        scoreLabels
          .attr("x", (d: any) => d.x)
          .attr("y", (d: any) => d.y - getNodeRadius(d) - 4);

        if (sourceLabels) {
          sourceLabels
            .attr("x", (d: any) => d.x)
            .attr("y", (d: any) => d.y - getNodeRadius(d) - 16);
        }
      });
    } else {
      // For single-source (no simulation), resolve link endpoints (which are
      // still node IDs, since no forceLink ran) and set positions from the
      // fixed radial coords so connection strength lines actually render.
      const nodeById = new Map(nodes.map((n) => [n.id, n]));
      const endpoint = (v: any): Node | undefined =>
        typeof v === "string" ? nodeById.get(v) : (v as Node);

      link
        .attr("x1", (d: any) => endpoint(d.source)?.x ?? 0)
        .attr("y1", (d: any) => endpoint(d.source)?.y ?? 0)
        .attr("x2", (d: any) => endpoint(d.target)?.x ?? 0)
        .attr("y2", (d: any) => endpoint(d.target)?.y ?? 0);

      node
        .attr("cx", (d: any) => d.x || 0)
        .attr("cy", (d: any) => d.y || 0);

      glowCircles
        .attr("cx", (d: any) => d.x || 0)
        .attr("cy", (d: any) => d.y || 0);

      // Set label positions for single source view
      categoryLabels
        .attr("x", (d: any) => d.x || 0)
        .attr("y", (d: any) => (d.y || 0) + getNodeRadius(d) + 8);

      scoreLabels
        .attr("x", (d: any) => d.x || 0)
        .attr("y", (d: any) => (d.y || 0) - getNodeRadius(d) - 4);
    }

    return () => {
      simulation?.stop();
    };
  }, [sources, selectedCategories, pinnedNode, showLabels, highlightSourceName]);

  return (
    <Card className="relative overflow-hidden bg-card/80 backdrop-blur-sm shadow-elegant border-border/50">
      <div className="p-6">
        <div className="mb-4 relative">
          {/* SonicSIM logo — blended, sized for the card headline */}
          <div className="flex items-center gap-4">
            <img
              src={sonicSimLogo}
              alt="SonicSIM.ai"
              width={1264}
              height={847}
              loading="lazy"
              decoding="async"
              className="h-9 sm:h-12 md:h-14 w-auto max-w-[40%] shrink-0 object-contain select-none pointer-events-none"
              style={{
                mixBlendMode: "screen",
                filter: "brightness(1.05) contrast(1.1)",
              }}
            />
            <div>
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
        </div>
        <div 
          className="relative h-[500px] rounded-lg bg-black border border-border/30 overflow-hidden"
          onClick={() => {
            // Click on empty area unpins the tooltip
            if (pinnedNode) {
              setPinnedNode(null);
              setHoveredNode(null);
            }
          }}
        >
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
            className={`w-full h-full relative z-10${animateNodes ? " audioscope-pulse" : ""}`}
            style={{ background: "transparent" }}
          />

          <GraphZoomControls
            className="top-4 right-4"
            currentZoom={currentZoom}
            onZoomIn={zoomIn}
            onZoomOut={zoomOut}
            onZoomReset={zoomReset}
            onFitToView={handleFitToView}
          >
            <Button
              variant={showLabels ? "ghost" : "secondary"}
              size="icon"
              className="h-8 w-8"
              onClick={() => setShowLabels(!showLabels)}
              title={showLabels ? "Hide labels" : "Show labels"}
            >
              {showLabels ? <Tag className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
            </Button>
            <Button
              variant={animateNodes ? "default" : "ghost"}
              size="icon"
              className="h-8 w-8"
              onClick={() => setAnimateNodes((v) => !v)}
              title={animateNodes ? "Stop node pulse" : "Animate nodes"}
              aria-pressed={animateNodes}
            >
              <Activity className="h-4 w-4" />
            </Button>
          </GraphZoomControls>

          <SimilarityPanel similarityMetrics={similarityMetrics} isMultiSource={sources.length > 1} />

          <CategoryLegend selectedCategories={selectedCategories} setSelectedCategories={setSelectedCategories} />

          {hoveredNode && (
            <NodeTooltip
              hoveredNode={hoveredNode}
              onDismissPinned={() => {
                setPinnedNode(null);
                setHoveredNode(null);
              }}
            />
          )}
        </div>
      </div>
    </Card>
  );
};
