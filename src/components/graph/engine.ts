import * as d3 from "d3";
import type { ZoomableNode } from "./types";

/**
 * The one force-graph renderer in the app.
 *
 * Both graph surfaces — the single-subject ontological fingerprint and the
 * aggregate cluster view — used to carry their own copy of this wiring: size the
 * SVG, bind zoom, draw links, run (or skip) a force simulation, drag nodes and
 * push positions on every tick. That is all here now. What genuinely differs
 * between the two is *what a node looks like* and *where the data comes from*,
 * so node painting is delegated to `drawNodes` and data shaping lives in the
 * adapters under `./adapters`.
 */

/** Anything the renderer can lay out: an id plus optional (possibly pinned) coords. */
export interface EngineNode extends ZoomableNode {
  id: string;
  x?: number;
  y?: number;
  fx?: number | null;
  fy?: number | null;
}

/** Link endpoints may be ids (resolved by forceLink) or node objects. */
export interface EngineLink<N extends EngineNode = EngineNode> {
  source: string | N;
  target: string | N;
}

/** Per-link stroke presentation, evaluated once at draw time. */
export interface LinkStyle<L> {
  stroke: (d: L) => string;
  opacity: (d: L) => number;
  width: (d: L) => number;
  dash?: (d: L) => string;
}

/**
 * What a node painter hands back: a `position` callback the renderer calls on
 * every tick (and once for fixed layouts), and the selection drag should bind to.
 */
export interface NodeLayer<N extends EngineNode> {
  position: () => void;
  dragTarget?: d3.Selection<never, N, never, unknown>;
}

export interface GraphRenderSpec<N extends EngineNode, L extends EngineLink<N>> {
  width: number;
  height: number;
  nodes: N[];
  links: L[];
  /**
   * Builds the force simulation. Return `null` for a fixed layout (the radial
   * fingerprint), in which case link endpoints are resolved by id and every
   * position is written exactly once.
   */
  simulation: ((nodes: N[], links: L[], width: number, height: number) => d3.Simulation<d3.SimulationNodeDatum, undefined>) | null;
  linkStyle: LinkStyle<L>;
  /** Gradients, filters and other `<defs>` content. */
  defs?: (defs: d3.Selection<SVGDefsElement, unknown, null, undefined>) => void;
  /** Chrome drawn on the SVG itself, outside the zoomable group (e.g. a backdrop). */
  background?: (svg: d3.Selection<SVGSVGElement, unknown, null, undefined>) => void;
  /** Content drawn behind links inside the zoomable group (e.g. cluster hulls). */
  underlay?: (group: d3.Selection<SVGGElement, unknown, null, undefined>) => void;
  /** Paints nodes and returns how to position them. */
  drawNodes: (
    group: d3.Selection<SVGGElement, unknown, null, undefined>,
    nodes: N[],
  ) => NodeLayer<N>;
  /** Extra work per tick, after links and nodes are positioned. */
  onTick?: () => void;
  /** Zoom behavior factory from `useGraphZoom`. */
  createZoomBehavior: (onZoom: (transform: d3.ZoomTransform) => void) => d3.ZoomBehavior<SVGSVGElement, unknown>;
}

/** Renders a graph into `svgEl`; returns a teardown for the effect cleanup. */
export function renderGraph<N extends EngineNode, L extends EngineLink<N>>(
  svgEl: SVGSVGElement,
  spec: GraphRenderSpec<N, L>,
): () => void {
  const { width, height, nodes, links } = spec;

  const svg = d3.select(svgEl);
  svg.selectAll("*").remove();
  svg.attr("width", width).attr("height", height);

  const defs = svg.append("defs");
  spec.defs?.(defs);

  const mainGroup = svg.append("g").attr("class", "main-group");
  const zoom = spec.createZoomBehavior((transform) => mainGroup.attr("transform", transform.toString()));
  svg.call(zoom);

  // Background sits on the SVG (not the zoomable group) so it never pans away.
  spec.background?.(svg);

  spec.underlay?.(mainGroup);

  const linkSel = mainGroup
    .append("g")
    .attr("class", "links")
    .selectAll<SVGLineElement, L>("line")
    .data(links)
    .join("line")
    .attr("stroke", (d) => spec.linkStyle.stroke(d))
    .attr("stroke-opacity", (d) => spec.linkStyle.opacity(d))
    .attr("stroke-width", (d) => spec.linkStyle.width(d));

  if (spec.linkStyle.dash) {
    linkSel.attr("stroke-dasharray", (d) => spec.linkStyle.dash!(d));
  }

  const nodeLayer = spec.drawNodes(mainGroup.append("g").attr("class", "nodes") as never, nodes);

  const simulation = spec.simulation?.(nodes, links, width, height) ?? null;

  // Fixed layouts never run forceLink, so their endpoints are still ids.
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const endpoint = (v: string | N): N | undefined => (typeof v === "string" ? byId.get(v) : v);

  const positionLinks = () => {
    linkSel
      .attr("x1", (d) => endpoint(d.source)?.x ?? 0)
      .attr("y1", (d) => endpoint(d.source)?.y ?? 0)
      .attr("x2", (d) => endpoint(d.target)?.x ?? 0)
      .attr("y2", (d) => endpoint(d.target)?.y ?? 0);
  };

  if (simulation) {
    if (nodeLayer.dragTarget) {
      nodeLayer.dragTarget.call(
        d3
          .drag<never, N>()
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
          }) as never,
      );
    }
    simulation.on("tick", () => {
      positionLinks();
      nodeLayer.position();
      spec.onTick?.();
    });
  } else {
    positionLinks();
    nodeLayer.position();
    spec.onTick?.();
  }

  return () => {
    simulation?.stop();
  };
}
