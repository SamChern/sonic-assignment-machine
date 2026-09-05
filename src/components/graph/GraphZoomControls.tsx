import type { ReactNode } from "react";
import { ZoomIn, ZoomOut, RotateCcw, Maximize } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface GraphZoomControlsProps {
  currentZoom: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onZoomReset: () => void;
  onFitToView: () => void;
  /** Positions the toolbar within its relative parent, e.g. "top-4 right-4". */
  className?: string;
  /** Extra buttons appended after a divider (e.g. labels/animate toggles). */
  children?: ReactNode;
}

/**
 * Zoom/pan/fit-to-view toolbar shared by every graph visualization. Both
 * NetworkVisualization and AggregateNetworkVisualization previously had a
 * byte-for-byte copy of these controls; this is the single source of truth.
 */
export const GraphZoomControls = ({
  currentZoom,
  onZoomIn,
  onZoomOut,
  onZoomReset,
  onFitToView,
  className,
  children,
}: GraphZoomControlsProps) => (
  <div
    className={cn(
      "absolute z-20 flex items-center gap-2 bg-card/95 backdrop-blur-sm rounded-lg p-2 border border-border/50 shadow-lg",
      className,
    )}
  >
    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onZoomOut} title="Zoom out" aria-label="Zoom out">
      <ZoomOut className="h-4 w-4" />
    </Button>
    <span className="text-xs text-muted-foreground min-w-[3rem] text-center font-medium">
      {Math.round(currentZoom * 100)}%
    </span>
    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onZoomIn} title="Zoom in" aria-label="Zoom in">
      <ZoomIn className="h-4 w-4" />
    </Button>
    <div className="w-px h-6 bg-border mx-1" />
    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onZoomReset} title="Reset zoom" aria-label="Reset zoom">
      <RotateCcw className="h-4 w-4" />
    </Button>
    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onFitToView} title="Fit all nodes to view" aria-label="Fit all nodes to view">
      <Maximize className="h-4 w-4" />
    </Button>
    {children && (
      <>
        <div className="w-px h-6 bg-border mx-1" />
        {children}
      </>
    )}
  </div>
);
