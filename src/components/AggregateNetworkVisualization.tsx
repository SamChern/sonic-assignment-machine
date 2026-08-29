import { useRef, useEffect, useState, useMemo } from "react";
import * as d3 from "d3";
import { Card } from "@/components/ui/card";
import { Users } from "lucide-react";
import { useGraphZoom } from "@/components/graph/useGraphZoom";
import { GraphZoomControls } from "@/components/graph/GraphZoomControls";
import { renderGraph } from "@/components/graph/engine";
import {
  aggregateNodeRadius,
  buildAggregateGraph,
  buildAggregateMetrics,
  determineOptimalK,
  kMeansClustering,
  type AggregateLink,
  type AggregateNode,
  type Cluster,
  type UserFingerprint,
} from "@/components/graph/adapters/aggregate";
import {
  appendAggregateBackground,
  appendAggregateDefs,
  drawAggregateNodes,
  drawClusterHulls,
} from "@/components/graph/painters/aggregateNodes";
import { ClusterLegend } from "@/components/aggregate-graph/ClusterLegend";
import { ClusterAnalysisCards } from "@/components/aggregate-graph/ClusterAnalysisCards";
import { AggregateSimilarityCard } from "@/components/aggregate-graph/AggregateSimilarityCard";
import { AggregateNodeTooltip } from "@/components/aggregate-graph/AggregateNodeTooltip";
import { AggregateCategoryLegend } from "@/components/aggregate-graph/AggregateCategoryLegend";
import samLogo from "@/assets/sam-logo.png";

interface AggregateNetworkVisualizationProps {
  fingerprints: UserFingerprint[];
  onUserClick?: (userId: string) => void;
}

const CANVAS_HEIGHT = 500;

/**
 * Aggregate (admin) view of many user fingerprints: k-means clusters, hulls and
 * similarity links. Clustering math lives in the `aggregate` adapter, drawing in
 * the `aggregateNodes` painter, and simulation/zoom/tick wiring in the shared
 * `renderGraph` engine.
 */
export const AggregateNetworkVisualization = ({
  fingerprints,
  onUserClick,
}: AggregateNetworkVisualizationProps) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const nodesRef = useRef<AggregateNode[]>([]);
  const [hoveredUser, setHoveredUser] = useState<UserFingerprint | null>(null);
  const [hoveredCluster, setHoveredCluster] = useState<Cluster | null>(null);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });

  const { currentZoom, createZoomBehavior, zoomIn, zoomOut, zoomReset, fitToView } = useGraphZoom(
    svgRef,
    CANVAS_HEIGHT,
  );

  const handleFitToView = () =>
    fitToView(
      nodesRef.current.map((n) => ({ x: n.x, y: n.y, radius: n.radius + 40 })),
      60,
    );

  const clusters = useMemo(() => {
    if (fingerprints.length < 2) return [];
    return kMeansClustering(fingerprints, determineOptimalK(fingerprints));
  }, [fingerprints]);

  const userClusterMap = useMemo(() => {
    const map = new globalThis.Map<string, Cluster>();
    clusters.forEach((cluster) =>
      cluster.members.forEach((member) => map.set(member.user_id, cluster)),
    );
    return map;
  }, [clusters]);

  const similarityMetrics = useMemo(() => buildAggregateMetrics(fingerprints), [fingerprints]);

  useEffect(() => {
    if (!svgRef.current || fingerprints.length === 0) return;

    const width = svgRef.current.clientWidth || 800;
    const { nodes, links } = buildAggregateGraph(
      fingerprints,
      (userId) => userClusterMap.get(userId),
      width,
      CANVAS_HEIGHT,
    );
    nodesRef.current = nodes;

    let hullGroup: d3.Selection<SVGGElement, unknown, null, undefined> | null = null;

    return renderGraph<AggregateNode, AggregateLink>(svgRef.current, {
      width,
      height: CANVAS_HEIGHT,
      nodes,
      links,
      createZoomBehavior,
      defs: appendAggregateDefs,
      background: (svg) => appendAggregateBackground(svg, width, CANVAS_HEIGHT),
      underlay: (group) => {
        hullGroup = group.append("g").attr("class", "hulls");
      },
      linkStyle: {
        stroke: (d) => (d.sameCluster ? d.source.color : "hsl(var(--muted-foreground))"),
        opacity: (d) => (d.sameCluster ? 0.4 : 0.15),
        width: (d) => (d.sameCluster ? 2 : 1),
        dash: (d) => (d.sameCluster ? "none" : "4 4"),
      },
      simulation: (simNodes, simLinks, w, h) =>
        d3
          .forceSimulation(simNodes as d3.SimulationNodeDatum[])
          .force("link", d3.forceLink(simLinks).distance((d: AggregateLink) => (d.sameCluster ? 80 : 150)))
          .force("charge", d3.forceManyBody().strength(-250))
          .force("center", d3.forceCenter(w / 2, h / 2))
          .force("collision", d3.forceCollide().radius((d: AggregateNode) => d.radius + 25))
          // Pull each node toward the live centroid of its own cluster.
          .force("cluster", (alpha: number) => {
            simNodes.forEach((node) => {
              if (!node.cluster) return;
              const peers = simNodes.filter((n) => n.cluster?.id === node.cluster?.id);
              if (peers.length < 2) return;
              const cx = peers.reduce((sum, n) => sum + (n.x || 0), 0) / peers.length;
              const cy = peers.reduce((sum, n) => sum + (n.y || 0), 0) / peers.length;
              const strength = alpha * 0.1;
              const sim = node as AggregateNode & { vx: number; vy: number };
              sim.vx += (cx - (node.x || 0)) * strength;
              sim.vy += (cy - (node.y || 0)) * strength;
            });
          }),
      drawNodes: (group, graphNodes) =>
        drawAggregateNodes(group, graphNodes, {
          onHover: (node, event) => {
            setHoveredUser(node?.fingerprint ?? null);
            setHoveredCluster(node?.cluster ?? null);
            if (node && event) setTooltipPos({ x: event.pageX, y: event.pageY });
          },
          onClick: onUserClick,
        }),
      onTick: () => {
        if (hullGroup) drawClusterHulls(hullGroup, clusters, nodes);
      },
    });
  }, [fingerprints, clusters, userClusterMap, onUserClick, createZoomBehavior]);

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
        <div className="absolute top-4 left-4 z-10 flex items-center gap-3">
          <img src={samLogo} alt="SonicSIM.ai" className="w-10 h-10" />
          <div>
            <h3 className="text-lg font-bold text-foreground">Aggregate User Fingerprints</h3>
            <p className="text-xs text-muted-foreground">
              {fingerprints.length} user{fingerprints.length !== 1 ? "s" : ""} •{" "}
              {clusters.length} cluster{clusters.length !== 1 ? "s" : ""} detected
            </p>
          </div>
        </div>

        <GraphZoomControls
          className="bottom-4 left-4"
          currentZoom={currentZoom}
          onZoomIn={zoomIn}
          onZoomOut={zoomOut}
          onZoomReset={zoomReset}
          onFitToView={handleFitToView}
        />

        <ClusterLegend
          clusters={clusters}
          hoveredCluster={hoveredCluster}
          onHoverCluster={setHoveredCluster}
        />

        <div className="relative w-full h-[500px]">
          <svg ref={svgRef} className="w-full h-full" />
          {/* Edge blur overlays */}
          <div className="absolute inset-0 pointer-events-none">
            <div className="absolute top-0 left-0 right-0 h-16 bg-gradient-to-b from-background to-transparent" />
            <div className="absolute bottom-0 left-0 right-0 h-16 bg-gradient-to-t from-background to-transparent" />
            <div className="absolute top-0 left-0 bottom-0 w-16 bg-gradient-to-r from-background to-transparent" />
            <div className="absolute top-0 right-0 bottom-0 w-16 bg-gradient-to-l from-background to-transparent" />
          </div>
        </div>

        {hoveredUser && (
          <AggregateNodeTooltip user={hoveredUser} cluster={hoveredCluster} position={tooltipPos} />
        )}
      </Card>

      <ClusterAnalysisCards clusters={clusters} />

      {similarityMetrics && <AggregateSimilarityCard metrics={similarityMetrics} />}

      <AggregateCategoryLegend />
    </div>
  );
};

export { aggregateNodeRadius };
export type { UserFingerprint };
