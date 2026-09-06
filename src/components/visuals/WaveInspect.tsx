/**
 * Enterprise scrub-and-inspect surface.
 *
 * wavesurfer.js v7 (BSD-3) drawn next to the Semantic Scope — never instead of
 * it. It drives the *same* media element the scope already reads (`media`
 * backend), so no second AudioContext or analyser is created, and it paints the
 * tag-fire trail as regions so a buyer can click straight to the moment a tag
 * fired. Loaded via dynamic import so consumer and admin bundles are unaffected.
 */
import { useThemeTick } from "@/hooks/useThemeTick";
import { useEffect, useRef, useState } from "react";
import { formatTrailTime, type TrailEntry } from "@/lib/audioscope/trail";

interface Props {
  mediaEl: HTMLMediaElement | null;
  trail: TrailEntry[];
  onSeek?: (entry: TrailEntry) => void;
  height?: number;
}

function cssVar(name: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v ? `hsl(${v})` : fallback;
}

export const WaveInspect = ({ mediaEl, trail, onSeek, height = 64 }: Props) => {
  const themeTick = useThemeTick();
  const hostRef = useRef<HTMLDivElement | null>(null);
  const wsRef = useRef<{ destroy: () => void } | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !mediaEl) return;
    let disposed = false;

    void (async () => {
      try {
        const { default: WaveSurfer } = await import("wavesurfer.js");
        if (disposed || !hostRef.current) return;
        const ws = WaveSurfer.create({
          container: hostRef.current,
          media: mediaEl as HTMLMediaElement,
          height,
          waveColor: cssVar("--muted-foreground", "hsl(191 10% 40%)"),
          progressColor: cssVar("--primary", "hsl(175 74% 31%)"),
          cursorColor: cssVar("--primary", "hsl(175 74% 31%)"),
          cursorWidth: 1,
          barWidth: 2,
          barGap: 1,
          normalize: true,
        });
        wsRef.current = ws as unknown as { destroy: () => void };
      } catch {
        if (!disposed) setFailed(true);
      }
    })();

    return () => {
      disposed = true;
      try {
        wsRef.current?.destroy();
      } catch {
        /* wavesurfer throws when the media element is already gone */
      }
      wsRef.current = null;
    };
  }, [mediaEl, height, themeTick]);

  if (!mediaEl) return null;

  return (
    <div className="rounded-xl border border-border/60 bg-background/60 p-2">
      <div className="mb-1 flex items-center justify-between gap-2 px-1">
        <span className="text-[11px] font-medium text-muted-foreground">
          Inspect · click or drag the waveform to scrub
        </span>
        <span className="text-[10px] text-muted-foreground">
          {trail.length} tag marker{trail.length === 1 ? "" : "s"}
        </span>
      </div>
      {failed ? (
        <p className="px-1 text-[11px] text-muted-foreground">
          The inspector couldn&apos;t load — the scope above still runs.
        </p>
      ) : (
        <div ref={hostRef} aria-label="Full-track waveform inspector" role="img" />
      )}
      {trail.length ? (
        <div className="mt-1.5 flex flex-wrap gap-1 px-1">
          {trail.slice(-8).map((entry) => (
            <button
              key={entry.t}
              type="button"
              onClick={() => onSeek?.(entry)}
              className="rounded border border-border/60 bg-background/70 px-1.5 py-0.5 text-[10px] tabular-nums text-muted-foreground hover:border-primary/60 hover:text-foreground"
            >
              {formatTrailTime(entry.t)} · {entry.tags[0]?.label ?? "window"}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
};

export default WaveInspect;
