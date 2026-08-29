import * as d3 from "d3";
import { CATEGORY_COLORS } from "@/components/network-graph/types";
import type { NodeLayer } from "@/components/graph/engine";
import { subjectNodeRadius, type SubjectNode } from "@/components/graph/adapters/singleSubject";

/**
 * Node painting for the subject (fingerprint / identity network) graph: glow
 * halo, scored circle, and the three label rows. Kept apart from the renderer
 * so the renderer stays graph-agnostic, and apart from the React component so
 * the component stays presentational.
 */

export interface SubjectNodeOptions {
  selectedCategories: Set<string>;
  highlightSourceName?: string | null;
  showLabels: boolean;
  showSourceLabels: boolean;
  onHover: (node: SubjectNode | null) => void;
  onClick: (node: SubjectNode) => void;
  /** When a tooltip is pinned, hover styling is suppressed. */
  isPinned: () => boolean;
}

const glowId = (category: string) => `glow-${category.replace(/\s+/g, "-")}`;

/** Radial gradients used by the glow halos; call from the renderer's `defs` hook. */
export function appendSubjectDefs(defs: d3.Selection<SVGDefsElement, unknown, null, undefined>) {
  Object.entries(CATEGORY_COLORS).forEach(([category, color]) => {
    const gradient = defs.append("radialGradient").attr("id", glowId(category));
    gradient.append("stop").attr("offset", "0%").attr("stop-color", color).attr("stop-opacity", 0.8);
    gradient.append("stop").attr("offset", "100%").attr("stop-color", color).attr("stop-opacity", 0);
  });
}

export function drawSubjectNodes(
  group: d3.Selection<SVGGElement, unknown, null, undefined>,
  nodes: SubjectNode[],
  opts: SubjectNodeOptions,
): NodeLayer<SubjectNode> {
  const { selectedCategories, highlightSourceName, showLabels, showSourceLabels } = opts;
  const isHighlighted = (d: SubjectNode) =>
    Boolean(highlightSourceName) && d.sourceName === highlightSourceName;

  const baseOpacity = (d: SubjectNode) => {
    if (highlightSourceName && !isHighlighted(d)) return 0.18;
    if (selectedCategories.size === 0) return isHighlighted(d) ? 1 : 0.8;
    return selectedCategories.has(d.category) ? 0.95 : 0.2;
  };

  const glow = group
    .append("g")
    .attr("class", "glow")
    .selectAll<SVGCircleElement, SubjectNode>("circle")
    .data(nodes)
    .join("circle")
    .attr("r", (d) => 24 + (d.score / 100) * 42)
    .attr("fill", (d) => `url(#${glowId(d.category)})`)
    .attr("opacity", (d) =>
      selectedCategories.size === 0 ? 0.5 : selectedCategories.has(d.category) ? 0.5 : 0.1,
    );

  const node = group
    .append("g")
    .attr("class", "node-circles")
    .selectAll<SVGCircleElement, SubjectNode>("circle")
    .data(nodes)
    .join("circle")
    .attr("r", (d) => subjectNodeRadius(d.score))
    .attr("fill", (d) => d.color)
    .attr("class", (d) => (isHighlighted(d) ? "as-node-highlight" : null))
    .attr("opacity", baseOpacity)
    .attr("stroke", (d) =>
      isHighlighted(d) || (selectedCategories.size > 0 && selectedCategories.has(d.category))
        ? "#fff"
        : "none",
    )
    .attr("stroke-width", (d) =>
      isHighlighted(d) ? 2.5 : selectedCategories.has(d.category) ? 2 : 0,
    )
    .style("cursor", "pointer")
    .on("mouseenter", (event, d) => {
      if (opts.isPinned()) return;
      opts.onHover(d);
      d3.select(event.currentTarget)
        .transition()
        .duration(200)
        .attr("r", 15 + (d.score / 100) * 30)
        .attr("opacity", 1);
    })
    .on("mouseleave", (event, d) => {
      if (opts.isPinned()) return;
      opts.onHover(null);
      d3.select(event.currentTarget)
        .transition()
        .duration(200)
        .attr("r", subjectNodeRadius(d.score))
        .attr("opacity", baseOpacity(d));
    })
    .on("click", (event, d) => {
      event.stopPropagation();
      opts.onClick(d);
    });

  const labelled = nodes.filter((n) => n.id !== "center");
  const labels = group
    .append("g")
    .attr("class", "labels")
    .style("opacity", showLabels ? 1 : 0)
    .style("transition", "opacity 0.3s ease");

  const textLayer = (
    cls: string,
    fill: string,
    fontSize: string,
    weight: string,
    opacity: (d: SubjectNode) => number,
    shadow: string,
    text: (d: SubjectNode) => string,
  ) =>
    labels
      .selectAll<SVGTextElement, SubjectNode>(`.${cls}`)
      .data(labelled)
      .join("text")
      .attr("class", cls)
      .attr("text-anchor", "middle")
      .attr("fill", fill)
      .attr("font-size", fontSize)
      .attr("font-weight", weight)
      .attr("opacity", opacity)
      .style("pointer-events", "none")
      .style("text-shadow", shadow)
      .text(text);

  const categoryLabels = textLayer(
    "category-label",
    "hsl(180, 60%, 85%)",
    "11px",
    "600",
    (d) => (selectedCategories.size === 0 ? 0.9 : selectedCategories.has(d.category) ? 1 : 0.3),
    "0 1px 3px rgba(0,0,0,0.8), 0 0 8px rgba(0,0,0,0.6)",
    (d) => d.category,
  ).attr("dominant-baseline", "hanging");

  const scoreLabels = textLayer(
    "score-label",
    "white",
    "10px",
    "700",
    (d) => (selectedCategories.size === 0 ? 0.85 : selectedCategories.has(d.category) ? 1 : 0.2),
    "0 1px 2px rgba(0,0,0,0.9)",
    (d) => `${d.score}%`,
  );

  const sourceLabels = showSourceLabels
    ? textLayer(
        "source-label",
        "hsl(180, 50%, 70%)",
        "9px",
        "400",
        (d) => (selectedCategories.size === 0 ? 0.7 : selectedCategories.has(d.category) ? 0.9 : 0.2),
        "0 1px 2px rgba(0,0,0,0.8)",
        (d) => (d.sourceName.length > 20 ? `${d.sourceName.substring(0, 18)}...` : d.sourceName),
      )
    : null;

  return {
    dragTarget: node as never,
    position: () => {
      node.attr("cx", (d) => d.x ?? 0).attr("cy", (d) => d.y ?? 0);
      glow.attr("cx", (d) => d.x ?? 0).attr("cy", (d) => d.y ?? 0);
      categoryLabels
        .attr("x", (d) => d.x ?? 0)
        .attr("y", (d) => (d.y ?? 0) + subjectNodeRadius(d.score) + 8);
      scoreLabels
        .attr("x", (d) => d.x ?? 0)
        .attr("y", (d) => (d.y ?? 0) - subjectNodeRadius(d.score) - 4);
      sourceLabels
        ?.attr("x", (d) => d.x ?? 0)
        .attr("y", (d) => (d.y ?? 0) - subjectNodeRadius(d.score) - 16);
    },
  };
}
