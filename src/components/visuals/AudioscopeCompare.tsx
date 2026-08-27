import { useEffect, useMemo, useRef, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Gauge, Image as ImageIcon, Info, Pause, Play, Waves } from "lucide-react";
import {
  AUDIOSCOPE_CATEGORIES,
  CATEGORY_LABELS,
  createSyntheticSignal,
  type CategoryScores,
} from "@/lib/audioscope";

export interface AudioscopeCompareEntity {
  id: string;
  label: string;
  color: string;
  scores: CategoryScores;
}

interface AudioscopeCompareProps {
  entities: AudioscopeCompareEntity[];
  /** 0-100 similarity, used for the phase-lock readout. */
  similarity?: number | null;
  height?: number;
}

/** Deterministic time offset (seconds) the Static view freezes on. */
const STATIC_FRAME_T = 1.25;

const prefersReducedMotion = () =>
  typeof window !== "undefined" &&
  Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);

function readVar(name: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v ? `hsl(${v})` : fallback;
}

/**
 * Dual scope: two (or more) fingerprints drawn as overlaid waveforms, with the
 * per-category delta filled as a difference band. Visual divergence tracks the
 * similarity score, so the number has a visual explanation.
 */
export const AudioscopeCompare = ({ entities, similarity, height = 240 }: AudioscopeCompareProps) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [playing, setPlaying] = useState(() => !prefersReducedMotion());
  const [speed, setSpeed] = useState(0.25);
  // Reduced-motion users get the still frame by default; they can opt back into motion.
  const [isStatic, setIsStatic] = useState(prefersReducedMotion);
  const [showLegend, setShowLegend] = useState(false);
  const rafRef = useRef<number | null>(null);
  const visibleRef = useRef(true);

  const reduced = useMemo(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches,
    [],
  );
  const isMobile = useMemo(() => typeof window !== "undefined" && window.innerWidth < 640, []);

  const pair = entities.slice(0, 2);
  const deltas = useMemo(() => {
    if (pair.length < 2) return [];
    return AUDIOSCOPE_CATEGORIES.map((c) =>
      Math.abs((Number(pair[0].scores[c]) || 0) - (Number(pair[1].scores[c]) || 0)),
    );
  }, [pair]);

  const staticDeltas = useMemo(
    () =>
      AUDIOSCOPE_CATEGORIES.map((c, i) => ({
        category: c,
        band: i + 1,
        delta: Math.round(deltas[i] ?? 0),
      })).sort((a, b) => b.delta - a.delta),
    [deltas],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || entities.length === 0) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const points = isMobile ? 300 : 640;
    const signals = entities.slice(0, 4).map((e) => ({
      entity: e,
      signal: createSyntheticSignal({ scores: e.scores, seed: e.id }),
      buf: new Float32Array(points),
    }));

    const colors = {
      bg: readVar("--background", "#06121a"),
      grid: readVar("--border", "#1f2937"),
      muted: readVar("--muted-foreground", "#94a3b8"),
      destructive: readVar("--destructive", "#ef4444"),
    };

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.floor((canvas.clientWidth || 600) * dpr);
      canvas.height = Math.floor((canvas.clientHeight || height) * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener("resize", resize);

    const io = new IntersectionObserver(
      (e) => {
        visibleRef.current = e[0]?.isIntersecting ?? true;
      },
      { threshold: 0.05 },
    );
    io.observe(canvas);

    const frame = (t: number) => {
      const w = canvas.clientWidth || 600;
      const h = canvas.clientHeight || height;
      const grad = ctx.createLinearGradient(0, 0, w, h);
      grad.addColorStop(0, colors.bg);
      grad.addColorStop(1, colors.grid);
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);

      ctx.globalAlpha = 0.15;
      ctx.strokeStyle = colors.grid;
      ctx.beginPath();
      ctx.moveTo(0, h / 2);
      ctx.lineTo(w, h / 2);
      ctx.stroke();
      ctx.globalAlpha = 1;

      signals.forEach((s) => s.signal.waveform(s.buf, t));

      // Difference band between the first two traces.
      if (signals.length >= 2) {
        ctx.globalAlpha = 0.2;
        ctx.fillStyle = colors.destructive;
        ctx.beginPath();
        for (let i = 0; i < points; i++) {
          const x = (i / (points - 1)) * w;
          ctx.lineTo(x, h / 2 + signals[0].buf[i] * (h * 0.36));
        }
        for (let i = points - 1; i >= 0; i--) {
          const x = (i / (points - 1)) * w;
          ctx.lineTo(x, h / 2 + signals[1].buf[i] * (h * 0.36));
        }
        ctx.closePath();
        ctx.fill();
        ctx.globalAlpha = 1;
      }

      signals.forEach((s) => {
        const trace = (alpha: number, width: number) => {
          ctx.globalAlpha = alpha;
          ctx.lineWidth = width;
          ctx.strokeStyle = s.entity.color;
          ctx.beginPath();
          for (let i = 0; i < points; i++) {
            const x = (i / (points - 1)) * w;
            const y = h / 2 + s.buf[i] * (h * 0.36);
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          }
          ctx.stroke();
          ctx.globalAlpha = 1;
        };
        trace(0.16, 7);
        trace(0.9, 1.8);
      });
    };

    if (isStatic || reduced || !playing) {
      frame(isStatic ? STATIC_FRAME_T : 0);
      return () => {
        window.removeEventListener("resize", resize);
        io.disconnect();
        signals.forEach((s) => s.signal.dispose());
      };
    }

    const rate = Math.max(0.1, Math.min(4, Number(speed) || 1));
    let elapsed = 0;
    let prev = performance.now();
    let last = 0;
    const minDelta = isMobile ? 1000 / 30 : 0;
    const loop = (now: number) => {
      rafRef.current = requestAnimationFrame(loop);
      if (!visibleRef.current) {
        prev = now;
        return;
      }
      if (now - last < minDelta) return;
      last = now;
      elapsed += ((now - prev) / 1000) * rate;
      prev = now;
      frame(elapsed);
    };
    rafRef.current = requestAnimationFrame(loop);

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      window.removeEventListener("resize", resize);
      io.disconnect();
      signals.forEach((s) => s.signal.dispose());
    };
  }, [entities, playing, speed, isStatic, reduced, isMobile, height]);

  if (entities.length === 0) return null;

  const sim = typeof similarity === "number" ? Math.round(similarity) : null;
  const lock = sim == null ? null : sim >= 80 ? "In phase" : sim >= 55 ? "Partial lock" : "Out of phase";

  return (
    <Card className="overflow-hidden border-border/60 bg-card/70 backdrop-blur-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/50 p-4">
        <div className="min-w-0">
          <h4 className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <Waves className="h-4 w-4 text-primary" />
            Dual audioscope
          </h4>
          <p className="mt-1 text-xs text-muted-foreground">
            Overlaid waveforms per fingerprint — the red band is the divergence the similarity score measures.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {lock ? (
            <span className="rounded-md border border-border bg-muted px-2 py-1 text-[11px] text-muted-foreground">
              {lock} · {sim}% similar
            </span>
          ) : null}
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5"
            onClick={() => {
              setPlaying((p) => {
                if (!p) setIsStatic(false);
                return !p;
              });
            }}
          >
            {playing && !isStatic ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
            {playing && !isStatic ? "Pause" : "Play"}
          </Button>
          <Button
            size="sm"
            variant={isStatic ? "default" : "outline"}
            className="gap-1.5"
            onClick={() =>
              setIsStatic((prev) => {
                if (!prev) setPlaying(false);
                return !prev;
              })
            }
            aria-pressed={isStatic}
            title="Freeze the dual audioscope on a single still frame"
          >
            <ImageIcon className="h-3.5 w-3.5" />
            Static
          </Button>
          <div className="flex items-center gap-1.5 rounded-md border border-border bg-muted/60 px-2 py-1">
            <Gauge className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
            <label className="sr-only" htmlFor="audioscope-compare-speed">
              Comparison animation speed
            </label>
            <select
              id="audioscope-compare-speed"
              value={String(speed)}
              disabled={isStatic}
              onChange={(e) => setSpeed(Number(e.target.value))}
              className="bg-transparent text-xs text-foreground outline-none disabled:opacity-50"
            >
              {[0.25, 0.5, 1, 1.5, 2, 3].map((v) => (
                <option key={v} value={v}>
                  {v}x
                </option>
              ))}
            </select>
          </div>
          <Button
            size="sm"
            variant={showLegend ? "default" : "outline"}
            className="gap-1.5"
            onClick={() => setShowLegend((v) => !v)}
            aria-expanded={showLegend}
          >
            <Info className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">How to read this</span>
          </Button>
        </div>
      </div>

      <div className="p-4">
        <canvas
          ref={canvasRef}
          role="img"
          aria-label="Overlaid audioscope comparison of selected fingerprints"
          className="w-full rounded-xl border border-border/60"
          style={{ height }}
        />

        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
          {entities.slice(0, 4).map((e) => (
            <span key={e.id} className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <span aria-hidden className="h-2 w-2 rounded-full" style={{ background: e.color }} />
              {e.label}
            </span>
          ))}
        </div>

        {showLegend ? (
          <div className="mt-4 grid gap-3 rounded-xl border border-border/60 bg-background/60 p-4 text-xs leading-relaxed text-muted-foreground sm:grid-cols-2">
            <div>
              <p className="mb-1 font-semibold text-foreground">Harmonic bands</p>
              <p>
                Each fingerprint&apos;s six category scores become six harmonic partials — Emotional
                lowest through Artistic highest. Score sets amplitude, so a trace bulges where that
                subject scores high on the semantic layer.
              </p>
            </div>
            {isStatic ? (
              <div className="sm:col-span-2 rounded-lg border border-primary/40 bg-primary/5 p-3">
                <p className="mb-1 font-semibold text-foreground">
                  Static mode — frozen at t = {STATIC_FRAME_T.toFixed(2)}s
                </p>
                <p className="mb-2">
                  Both traces and the divergence band are sampled at that one timestamp, so the gap
                  you see is a fixed, comparable snapshot. Per-category Δ at this frame, largest
                  first — the top rows are the ontology nodes lit hardest in the frozen frame:
                </p>
                <ul className="grid gap-1 sm:grid-cols-2">
                  {staticDeltas.map((d) => (
                    <li key={d.category} className="flex items-center gap-2">
                      <span
                        aria-hidden
                        className="h-2 w-2 shrink-0 rounded-full"
                        style={{ background: `hsl(var(--category-${d.category}))` }}
                      />
                      <span className="text-foreground">
                        Band {d.band} · {CATEGORY_LABELS[d.category] ?? d.category}
                      </span>
                      <span>Δ {d.delta}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            <div>
              <p className="mb-1 font-semibold text-foreground">Divergence &amp; nodes</p>
              <p>
                The red fill is the instantaneous gap between the two traces: wide band = low
                similarity. Per-category Δ tiles below name which ontology nodes drive that gap, and
                those same nodes pulse in Node pulse mode and in the network graph.
              </p>
            </div>
          </div>
        ) : null}

        {deltas.length > 0 ? (
          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            {AUDIOSCOPE_CATEGORIES.map((c, i) => (
              <div key={c} className="rounded-lg border border-border/50 bg-background/50 p-2">
                <p className="truncate text-[10px] uppercase tracking-wide text-muted-foreground">
                  {CATEGORY_LABELS[c]}
                </p>
                <p className="text-sm font-semibold text-foreground">Δ {Math.round(deltas[i])}</p>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </Card>
  );
};

export default AudioscopeCompare;
