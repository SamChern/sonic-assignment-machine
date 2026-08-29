/**
 * Tag-fire trail strip — the thin timeline that sits directly under the
 * waveform (the waveform itself stays untouched: it's the brand).
 *
 * Each marker is a scored window. Hover reads out its tags; clicking seeks the
 * media element to that moment and freezes the meaning lens on the snapshot the
 * model produced there. For zero-audio silhouettes there is nothing to seek, so
 * the strip renders read-only.
 */
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { formatTrailTime, trailPosition, type TrailEntry } from "@/lib/audioscope/trail";

interface Props {
  trail: TrailEntry[];
  /** Timeline span in seconds (media duration, or the latest window). */
  span: number;
  /** Currently frozen entry, if any. */
  selected?: TrailEntry | null;
  /** Omitted for silhouettes — makes the strip read-only. */
  onSeek?: (entry: TrailEntry) => void;
  onClear?: () => void;
}

export const ScopeTrail = ({ trail, span, selected = null, onSeek, onClear }: Props) => {
  const seekable = Boolean(onSeek);

  return (
    <div className="rounded-xl border border-border/60 bg-background/60 px-2 py-1.5">
      <div className="mb-1 flex items-center justify-between gap-2 px-1">
        <span className="text-[10px] font-medium text-muted-foreground">
          Tag-fire trail{seekable ? " · click a marker to scrub back" : " · silhouette (read-only)"}
        </span>
        {selected ? (
          <button
            type="button"
            onClick={onClear}
            className="text-[10px] text-primary underline-offset-2 hover:underline"
          >
            Resume live ({formatTrailTime(selected.t)} frozen)
          </button>
        ) : (
          <span className="text-[10px] tabular-nums text-muted-foreground">
            {trail.length} window{trail.length === 1 ? "" : "s"}
          </span>
        )}
      </div>

      <TooltipProvider delayDuration={80}>
        <div
          role="group"
          aria-label="Tag-fire trail"
          className="relative h-6 w-full rounded-md bg-muted/30"
        >
          {trail.length === 0 ? (
            <span className="absolute inset-0 flex items-center justify-center text-[10px] text-muted-foreground">
              No scored windows yet
            </span>
          ) : null}
          {trail.map((entry) => {
            const left = `${trailPosition(entry, span) * 100}%`;
            const top = entry.tags[0];
            const isSelected = selected?.t === entry.t;
            const label = `${formatTrailTime(entry.t)} — ${top?.label ?? "no tag"}`;
            return (
              <Tooltip key={`${entry.t}-${top?.code ?? "none"}`}>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    aria-label={label}
                    disabled={!seekable}
                    onClick={() => onSeek?.(entry)}
                    style={{ left }}
                    className={`absolute top-0 h-6 w-2 -translate-x-1/2 rounded-sm transition-colors ${
                      isSelected ? "bg-primary" : "bg-primary/45 hover:bg-primary/80"
                    } ${seekable ? "cursor-pointer" : "cursor-default"}`}
                  />
                </TooltipTrigger>
                <TooltipContent side="top" className="max-w-[220px] text-[11px]">
                  <p className="font-medium tabular-nums">{formatTrailTime(entry.t)}</p>
                  <ul className="mt-0.5 space-y-0.5">
                    {entry.tags.slice(0, 4).map((t) => (
                      <li key={t.code} className="flex justify-between gap-2">
                        <span className="truncate">{t.label}</span>
                        <span className="tabular-nums text-muted-foreground">
                          {(t.similarity * 100).toFixed(0)}%
                        </span>
                      </li>
                    ))}
                  </ul>
                </TooltipContent>
              </Tooltip>
            );
          })}
        </div>
      </TooltipProvider>
    </div>
  );
};

export default ScopeTrail;
