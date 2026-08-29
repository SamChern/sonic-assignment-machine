import * as d3 from "d3";
import type { NodeLayer } from "@/components/graph/engine";
import {
  CLUSTER_COLORS,
  type AggregateNode,
  type Cluster,
  type UserFingerprint,
} from "@/components/graph/adapters/aggregate";

/**
 * Node painting for the aggregate cluster graph: per-user contour rings, the
 * logo disc, username, source-count badge, and the convex cluster hulls.
 */

export interface AggregateNodeOptions {
  onHover: (node: AggregateNode | null, event?: MouseEvent) => void;
  onClick?: (userId: string) => void;
}

/** Background gradient + one soft glow filter per cluster color. */
export function appendAggregateDefs(defs: d3.Selection<SVGDefsElement, unknown, null, undefined>) {
  const bg = defs.append("radialGradient").attr("id", "aggregate-bg-gradient");
  bg.append("stop")
    .attr("offset", "0%")
    .attr("stop-color", "hsl(var(--primary))")
    .attr("stop-opacity", 0.05);
  bg.append("stop").attr("offset", "100%").attr("stop-color", "transparent");

  CLUSTER_COLORS.forEach((color, index) => {
    const filter = defs
      .append("filter")
      .attr("id", `logo-glow-${index}`)
      .attr("x", "-50%")
      .attr("y", "-50%")
      .attr("width", "200%")
      .attr("height", "200%");
    filter.append("feGaussianBlur").attr("stdDeviation", "3").attr("result", "coloredBlur");
    filter
      .append("feFlood")
      .attr("flood-color", color)
      .attr("flood-opacity", "0.7")
      .attr("result", "glowColor");
    filter
      .append("feComposite")
      .attr("in", "glowColor")
      .attr("in2", "coloredBlur")
      .attr("operator", "in")
      .attr("result", "softGlow");
    const merge = filter.append("feMerge");
    merge.append("feMergeNode").attr("in", "softGlow");
    merge.append("feMergeNode").attr("in", "softGlow");
    merge.append("feMergeNode").attr("in", "SourceGraphic");
  });
}

/** Backdrop rect; drawn on the SVG so it doesn't pan with the graph. */
export function appendAggregateBackground(
  svg: d3.Selection<SVGSVGElement, unknown, null, undefined>,
  width: number,
  height: number,
) {
  svg
    .insert("rect", ":first-child")
    .attr("width", width)
    .attr("height", height)
    .attr("fill", "url(#aggregate-bg-gradient)");
}

/** Recomputes the expanded convex hull per cluster; called every tick. */
export function drawClusterHulls(
  hullGroup: d3.Selection<SVGGElement, unknown, null, undefined>,
  clusters: Cluster[],
  nodes: AggregateNode[],
) {
  hullGroup.selectAll("path").remove();
  clusters.forEach((cluster) => {
    const members = nodes.filter((n) => n.cluster?.id === cluster.id);
    if (members.length < 3) return;

    const points: [number, number][] = members.map((n) => [n.x ?? 0, n.y ?? 0]);
    const hull = d3.polygonHull(points);
    if (!hull) return;

    const cx = points.reduce((sum, p) => sum + p[0], 0) / points.length;
    const cy = points.reduce((sum, p) => sum + p[1], 0) / points.length;
    const expanded = hull.map(([x, y]) => {
      const dx = x - cx;
      const dy = y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      return [x + (dx / dist) * 40, y + (dy / dist) * 40] as [number, number];
    });

    hullGroup
      .append("path")
      .attr("d", `M${expanded.join("L")}Z`)
      .attr("fill", cluster.color)
      .attr("fill-opacity", 0.08)
      .attr("stroke", cluster.color)
      .attr("stroke-opacity", 0.3)
      .attr("stroke-width", 2)
      .attr("stroke-dasharray", "8 4");
  });
}

export function drawAggregateNodes(
  group: d3.Selection<SVGGElement, unknown, null, undefined>,
  nodes: AggregateNode[],
  opts: AggregateNodeOptions,
): NodeLayer<AggregateNode> {
  const nodeElements = group
    .selectAll<SVGGElement, AggregateNode>("g")
    .data(nodes)
    .join("g")
    .attr("opacity", (d) => d.opacity)
    .attr("cursor", "pointer");

  // Fingerprint contour rings, outermost first.
  const numRings = 8;
  for (let ring = numRings; ring >= 1; ring--) {
    nodeElements
      .append("ellipse")
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

  const mainCircle = nodeElements
    .append("circle")
    .attr("class", "user-disc")
    .attr("r", (d) => d.radius)
    .attr("fill", (d) => d.color)
    .attr("stroke", "hsl(var(--background))")
    .attr("stroke-width", 2);

  // Screen blend makes the logo's black background read as transparent.
  nodeElements
    .append("image")
    .attr("href", "/images/sam-logo.png")
    .attr("width", (d) => d.radius * 1.6)
    .attr("height", (d) => d.radius * 0.8)
    .attr("x", (d) => -d.radius * 0.8)
    .attr("y", (d) => -d.radius * 0.4)
    .attr("opacity", 0.9)
    .attr("filter", (d) => `url(#logo-glow-${d.cluster?.id ?? 0})`)
    .style("mix-blend-mode", "screen")
    .style("pointer-events", "none");

  nodeElements
    .append("text")
    .attr("text-anchor", "middle")
    .attr("y", (d) => d.radius + 20)
    .attr("fill", "hsl(var(--foreground))")
    .attr("font-size", 11)
    .attr("font-weight", 500)
    .text((d) => d.fingerprint.username || "User");

  nodeElements
    .append("circle")
    .attr("cx", (d) => d.radius * 0.7)
    .attr("cy", (d) => -d.radius * 0.7)
    .attr("r", 12)
    .attr("fill", "hsl(var(--background))")
    .attr("stroke", (d) => d.color)
    .attr("stroke-width", 2);

  nodeElements
    .append("text")
    .attr("x", (d) => d.radius * 0.7)
    .attr("y", (d) => -d.radius * 0.7)
    .attr("text-anchor", "middle")
    .attr("dominant-baseline", "middle")
    .attr("fill", "hsl(var(--foreground))")
    .attr("font-size", 9)
    .attr("font-weight", "bold")
    .text((d) => d.fingerprint.total_sources_analyzed);

  nodeElements
    .on("mouseenter", function (event: MouseEvent, d) {
      opts.onHover(d, event);
      d3.select(this)
        .select(".user-disc")
        .transition()
        .duration(200)
        .attr("r", d.radius * 1.2);
    })
    .on("mouseleave", function (_event, d) {
      opts.onHover(null);
      d3.select(this).select(".user-disc").transition().duration(200).attr("r", d.radius);
    })
    .on("click", (_event, d) => opts.onClick?.(d.id));

  void mainCircle;

  return {
    dragTarget: nodeElements as never,
    position: () => {
      nodeElements.attr("transform", (d) => `translate(${d.x ?? 0}, ${d.y ?? 0})`);
    },
  };
}

export type { UserFingerprint };
