import { useCallback, useRef, useState, type RefObject } from "react";
import * as d3 from "@/lib/d3";
import type { ZoomableNode } from "./types";

/**
 * Encapsulates the zoom/pan/fit-to-view behaviour shared by every D3
 * force-graph in the app (NetworkVisualization + AggregateNetworkVisualization).
 * The D3 draw effect still owns node/link rendering; this hook only owns the
 * zoom behavior lifecycle and the toolbar actions that manipulate it.
 */
export function useGraphZoom(
  svgRef: RefObject<SVGSVGElement>,
  /** Fixed SVG height when the caller doesn't rely on clientHeight (e.g. aggregate view uses a fixed 500px canvas). */
  fixedHeight?: number,
) {
  const zoomRef = useRef<d3.ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const [currentZoom, setCurrentZoom] = useState(1);

  /** Creates and registers the zoom behavior; call once inside the draw effect. */
  const createZoomBehavior = useCallback((onZoom: (transform: d3.ZoomTransform) => void) => {
    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.3, 4])
      .on("zoom", (event) => {
        onZoom(event.transform);
        setCurrentZoom(event.transform.k);
      });
    zoomRef.current = zoom;
    return zoom;
  }, []);

  const zoomIn = useCallback(() => {
    if (svgRef.current && zoomRef.current) {
      d3.select(svgRef.current).transition().duration(300).call(zoomRef.current.scaleBy, 1.3);
    }
  }, [svgRef]);

  const zoomOut = useCallback(() => {
    if (svgRef.current && zoomRef.current) {
      d3.select(svgRef.current).transition().duration(300).call(zoomRef.current.scaleBy, 0.7);
    }
  }, [svgRef]);

  const zoomReset = useCallback(() => {
    if (svgRef.current && zoomRef.current) {
      d3.select(svgRef.current).transition().duration(300).call(zoomRef.current.transform, d3.zoomIdentity);
    }
  }, [svgRef]);

  const fitToView = useCallback((nodes: ZoomableNode[], padding = 80) => {
    if (!svgRef.current || !zoomRef.current || nodes.length === 0) return;

    const width = svgRef.current.clientWidth || 800;
    const height = fixedHeight ?? svgRef.current.clientHeight;

    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    nodes.forEach((node) => {
      const x = node.x ?? width / 2;
      const y = node.y ?? height / 2;
      const r = node.radius;
      minX = Math.min(minX, x - r);
      maxX = Math.max(maxX, x + r);
      minY = Math.min(minY, y - r);
      maxY = Math.max(maxY, y + r);
    });

    const boundingWidth = maxX - minX;
    const boundingHeight = maxY - minY;
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;

    const scale = Math.min(
      (width - padding * 2) / boundingWidth,
      (height - padding * 2) / boundingHeight,
      2, // Max zoom of 2x
    );

    const translateX = width / 2 - centerX * scale;
    const translateY = height / 2 - centerY * scale;

    d3.select(svgRef.current)
      .transition()
      .duration(500)
      .call(
        zoomRef.current.transform,
        d3.zoomIdentity.translate(translateX, translateY).scale(scale),
      );
  }, [svgRef, fixedHeight]);

  return { zoomRef, currentZoom, setCurrentZoom, createZoomBehavior, zoomIn, zoomOut, zoomReset, fitToView };
}
