// Shared types for the two D3 force-graph visualizations (single-subject
// ontology fingerprint and aggregate/admin cluster view). Both graphs use
// zoom/pan/fit-to-view in an identical way even though their node/link
// rendering differs, so that behaviour is centralized here.

/** Minimal shape needed to compute a fit-to-view bounding box for a node. */
export interface ZoomableNode {
  x?: number;
  y?: number;
  /** Effective on-screen radius, including any label/ring padding. */
  radius: number;
}
