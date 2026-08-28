import { CATEGORY_COLORS } from "./types";

interface TooltipData {
  source: string;
  category: string;
  score: number;
  description: string;
  isPinned: boolean;
}

interface NodeTooltipProps {
  /** Raw JSON-encoded tooltip payload set by the D3 hover/click handlers. */
  hoveredNode: string;
  onDismissPinned: () => void;
}

/** Hover (auto) / pinned (click, persists) tooltip shown above the graph. */
export const NodeTooltip = ({ hoveredNode, onDismissPinned }: NodeTooltipProps) => {
  let tooltipData: TooltipData | null = null;
  try {
    tooltipData = JSON.parse(hoveredNode) as TooltipData;
  } catch {
    tooltipData = null;
  }

  if (!tooltipData) {
    return (
      <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-card/95 backdrop-blur-md border border-primary/30 rounded-lg px-4 py-2 shadow-lg z-30">
        <div className="text-xs font-semibold text-foreground whitespace-nowrap">{hoveredNode}</div>
      </div>
    );
  }

  const { isPinned } = tooltipData;

  return (
    <div
      className={`absolute top-4 left-1/2 -translate-x-1/2 bg-card/98 backdrop-blur-xl border rounded-xl shadow-2xl z-30 animate-fade-in ${
        isPinned ? 'border-primary/60 max-w-sm px-5 py-4' : 'border-primary/40 max-w-xs px-5 py-4'
      }`}
      onClick={(e) => {
        if (isPinned) {
          e.stopPropagation();
          onDismissPinned();
        }
      }}
      style={{ cursor: isPinned ? 'pointer' : 'default' }}
    >
      <div className="flex items-start gap-3">
        <div
          className={`rounded-full mt-1 flex-shrink-0 ${isPinned ? 'w-4 h-4' : 'w-3 h-3'}`}
          style={{
            backgroundColor: CATEGORY_COLORS[tooltipData.category] || 'hsl(170, 80%, 55%)',
            boxShadow: isPinned ? '0 0 12px currentColor' : '0 0 8px currentColor',
          }}
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <div className="text-xs text-muted-foreground truncate">{tooltipData.source}</div>
            {isPinned && (
              <span className="text-[10px] text-primary/70 bg-primary/10 px-1.5 py-0.5 rounded shrink-0">
                Click to close
              </span>
            )}
          </div>
          <div className={`font-semibold text-foreground flex items-center gap-2 ${isPinned ? 'text-base mt-1' : 'text-sm'}`}>
            <span>{tooltipData.category}</span>
            <span className="text-primary font-bold">{tooltipData.score}%</span>
          </div>
          {tooltipData.description && (
            <p className={`text-muted-foreground leading-relaxed ${isPinned ? 'text-sm mt-3' : 'text-xs mt-2'}`}>
              {tooltipData.description}
            </p>
          )}
        </div>
      </div>
    </div>
  );
};
