import { useEffect, useRef, useState } from "react";
import { Activity, Tag, EyeOff } from "lucide-react";
import * as d3 from "@/lib/d3";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import sonicSimLogo from "@/assets/SonicSIM_blend.png";
import { useGraphZoom } from "@/components/graph/useGraphZoom";
import { GraphZoomControls } from "@/components/graph/GraphZoomControls";
import { CategoryLegend } from "@/components/network-graph/CategoryLegend";
import { NodeTooltip } from "@/components/network-graph/NodeTooltip";
import { SimilarityPanel } from "@/components/network-graph/SimilarityPanel";
import { renderGraph } from "@/components/graph/engine";
import {
  buildSubjectGraph,
  subjectNodeRadius,
  type SubjectLink,
  type SubjectNode,
} from "@/components/graph/adapters/singleSubject";
import { appendSubjectDefs, drawSubjectNodes } from "@/components/graph/painters/subjectNodes";
import type { SourceAnalysis, SimilarityMetrics } from "@/components/network-graph/types";

interface NetworkVisualizationProps {
  sources: SourceAnalysis[];
  sourceImages?: Array<{ name: string; imageUrl: string }>;
  /** Source name whose ontology nodes should pulse/highlight (driven by "See my SonicSIM"). */
  highlightSourceName?: string | null;
}

/**
 * The single-subject ontological fingerprint / multi-source identity network.
 * Layout + link math live in the `singleSubject` adapter, drawing in the
 * `subjectNodes` painter, and the simulation/zoom/tick wiring in the shared
 * `renderGraph` engine — this component only owns React state and chrome.
 */
export const NetworkVisualization = ({
  sources,
  sourceImages = [],
  highlightSourceName = null,
}: NetworkVisualizationProps) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const nodesRef = useRef<SubjectNode[]>([]);
  const pinnedRef = useRef<string | null>(null);
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

  pinnedRef.current = pinnedNode;

  const { currentZoom, createZoomBehavior, zoomIn, zoomOut, zoomReset, fitToView } = useGraphZoom(svgRef);

  const handleFitToView = () => {
    fitToView(
      nodesRef.current.map((n) => ({ x: n.x, y: n.y, radius: subjectNodeRadius(n.score) + 50 })),
      80,
    );
  };

  const tooltipFor = (node: SubjectNode, isPinned: boolean) => {
    const description =
      sources
        .find((s) => s.name === node.sourceName)
        ?.categories.find((c) => c.name === node.category)?.description || "";
    return JSON.stringify({
      source: node.sourceName,
      category: node.category,
      score: node.score,
      description:
        isPinned || description.length <= 100 ? description : `${description.substring(0, 100)}...`,
      isPinned,
    });
  };

  useEffect(() => {
    if (!svgRef.current || !sources.length) return;

    const width = svgRef.current.clientWidth;
    const height = svgRef.current.clientHeight;

    const graph = buildSubjectGraph(sources, width, height);
    nodesRef.current = graph.nodes;
    setSimilarityMetrics(graph.metrics);

    return renderGraph<SubjectNode, SubjectLink>(svgRef.current, {
      width,
      height,
      nodes: graph.nodes,
      links: graph.links,
      createZoomBehavior,
      defs: appendSubjectDefs,
      // The radial fingerprint is a fixed layout; only the multi-source
      // identity network runs forces.
      simulation: graph.isSingleSource
        ? null
        : (nodes, links, w, h) =>
            d3
              .forceSimulation(nodes as d3.SimulationNodeDatum[])
              .force(
                "link",
                d3
                  .forceLink(links)
                  .id((d: d3.SimulationNodeDatum & { id?: string }) => d.id as string)
                  .distance((d: SubjectLink) => (d.strength > 0.6 ? 50 : d.strength > 0.3 ? 100 : 180))
                  .strength((d: SubjectLink) => d.strength),
              )
              .force("charge", d3.forceManyBody().strength(-250).distanceMax(400))
              .force("center", d3.forceCenter(w / 2, h / 2))
              .force(
                "collision",
                d3
                  .forceCollide()
                  .radius((d: SubjectNode) => 12 + (d.score / 100) * 28)
                  .strength(0.9),
              )
              // Gentle pull of same-category nodes toward their own centroid so
              // categories read as clusters.
              .force("cluster", () => {
                const centers: Record<string, { x: number; y: number; count: number }> = {};
                nodes.forEach((node) => {
                  if (node.x === undefined || node.y === undefined) return;
                  const c = (centers[node.category] ||= { x: 0, y: 0, count: 0 });
                  c.x += node.x;
                  c.y += node.y;
                  c.count += 1;
                });
                nodes.forEach((node) => {
                  const c = centers[node.category];
                  if (!c || !c.count || node.x === undefined || node.y === undefined) return;
                  node.x += (c.x / c.count - node.x) * 0.15;
                  node.y += (c.y / c.count - node.y) * 0.15;
                });
              }),
      linkStyle: {
        stroke: (d) =>
          d.strength > 0.6
            ? "hsl(180, 65%, 52%)"
            : d.strength > 0.3
              ? "hsl(180, 50%, 45%)"
              : "hsl(180, 35%, 38%)",
        opacity: (d) => (d.strength > 0.6 ? 0.6 : d.strength > 0.3 ? 0.3 : 0.12),
        width: (d) => (d.strength > 0.6 ? 3 : d.strength > 0.3 ? 1.8 : 0.9),
      },
      drawNodes: (group, nodes) =>
        drawSubjectNodes(group, nodes, {
          selectedCategories,
          highlightSourceName,
          showLabels,
          showSourceLabels: !graph.isSingleSource,
          isPinned: () => Boolean(pinnedRef.current),
          onHover: (node) => setHoveredNode(node ? tooltipFor(node, false) : null),
          onClick: (node) => {
            if (pinnedRef.current === node.id) {
              setPinnedNode(null);
              setHoveredNode(null);
            } else {
              setPinnedNode(node.id);
              setHoveredNode(tooltipFor(node, true));
            }
          },
        }),
    });
  }, [sources, selectedCategories, pinnedNode, showLabels, highlightSourceName, createZoomBehavior]);

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
              style={{ mixBlendMode: "screen", filter: "brightness(1.05) contrast(1.1)" }}
            />
            <div>
              <h3 className="text-lg font-semibold text-foreground">
                {sources.length === 1 ? "Ontological Fingerprint" : "Ontological Identity Network"}
              </h3>
              <p className="text-sm text-muted-foreground">
                {sources.length === 1
                  ? "Radial view showing category centrality to source identity • Line thickness = score strength"
                  : "Natural clustering shows category proximity • Node size = category prevalence strength • Blue-green spectrum"}
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
          {sourceImages.length > 0 && (
            <div className="absolute inset-0 flex items-center justify-center">
              {sourceImages.map((source, index) => (
                <img
                  key={source.name}
                  src={source.imageUrl}
                  alt={source.name}
                  className="absolute w-64 h-64 object-cover opacity-30 blur-sm"
                  style={{
                    transform: `translate(${((index % 3) - 1) * 150}px, ${Math.floor(index / 3) * 150 - 100}px) rotate(${index * 15}deg)`,
                    filter: "grayscale(30%) brightness(0.7)",
                    mixBlendMode: "screen",
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

          <CategoryLegend
            selectedCategories={selectedCategories}
            setSelectedCategories={setSelectedCategories}
          />

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
