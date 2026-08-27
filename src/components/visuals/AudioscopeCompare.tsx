import { useEffect, useMemo, useRef, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  PANE_ANCHOR_ATTR,
  SHORTCUT_HINT,
  focusMotionControls,
  useAudioscopeShortcuts,

} from "@/lib/audioscope/shortcuts";
import { Accessibility, Gauge, Image as ImageIcon, Info, Pause, Play, Waves } from "lucide-react";
import {
  AUDIOSCOPE_CATEGORIES,
  CATEGORY_LABELS,
  createSyntheticSignal,
  type CategoryScores,
  initialStatic,
  prefersReducedMotion,
  writeMotionPref,
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

const MOTION_PREF_KEY = "sonicsim.audioscope.compare.motion";

/** Transport chips — smaller and blended into the panel surface. */
const TRANSPORT_CLS =
  "h-7 gap-1 rounded-md border border-border/40 bg-background/30 px-2 text-[11px] font-normal text-muted-foreground backdrop-blur-sm hover:bg-background/50 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";
const TRANSPORT_CLS_ACTIVE =
  "h-7 gap-1 rounded-md border border-primary/40 bg-primary/15 px-2 text-[11px] font-normal text-foreground backdrop-blur-sm hover:bg-primary/25 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";

/** Deterministic time offset (seconds) the Static view freezes on. */
const STATIC_FRAME_T = 1.25;


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
  const [playing, setPlaying] = useState(() => !initialStatic(MOTION_PREF_KEY));
  const [speed, setSpeed] = useState(0.25);
  // Reduced-motion users get the still frame by default; they can opt back into motion.
  const [isStatic, setIsStatic] = useState(() => initialStatic(MOTION_PREF_KEY));
  const [reducedMotion, setReducedMotion] = useState(prefersReducedMotion);
  const [showLegend, setShowLegend] = useState(false);
  const rafRef = useRef<number | null>(null);
  const staticBtnRef = useRef<HTMLButtonElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);

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
    writeMotionPref(MOTION_PREF_KEY, isStatic ? "static" : "motion");
  }, [isStatic]);

  useEffect(() => {
    const mq = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (!mq) return;
    const onChange = () => setReducedMotion(mq.matches);
    mq.addEventListener?.("change", onChange);
    return () => mq.removeEventListener?.("change", onChange);
  }, []);

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

  const animating = playing && !isStatic;

  // Same semantics as the SonicSIM panel: Play always leaves Static, and
  // entering Static always halts motion.
  const togglePlay = () => {
    const next = !animating;
    setPlaying(next);
    if (next) setIsStatic(false);
  };

  const toggleStatic = () => {
    setIsStatic((prev) => {
      const next = !prev;
      if (next) setPlaying(false);
      return next;
    });
  };

  // S = Static, K = Play/Pause, [ / ] = move between audioscope panes.
  useAudioscopeShortcuts({
    containerRef: rootRef,
    onToggleStatic: toggleStatic,
    onTogglePlay: togglePlay,
    enabled: entities.length > 0,
  });

  if (entities.length === 0) return null;

  const sim = typeof similarity === "number" ? Math.round(similarity) : null;
  const lock = sim == null ? null : sim >= 80 ? "In phase" : sim >= 55 ? "Partial lock" : "Out of phase";

  return (
    <Card ref={rootRef} className="overflow-hidden border-border/60 bg-card/70 backdrop-blur-sm">
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
        <div role="group" aria-label="Comparison playback controls" className="flex items-center gap-1.5">
          {lock ? (
            <span className="rounded-md border border-border/40 bg-background/30 px-2 py-1 text-[11px] text-muted-foreground">
              {lock} · {sim}% similar
            </span>
          ) : null}
          <Button
            size="sm"
            variant="ghost"
            className={TRANSPORT_CLS}
            onClick={togglePlay}
            aria-pressed={animating}
            aria-keyshortcuts="K"
            aria-describedby="audioscope-compare-shortcut-hint audioscope-compare-status"
          >
            {animating ? <Pause className="h-3 w-3" aria-hidden /> : <Play className="h-3 w-3" aria-hidden />}
            {animating ? "Pause" : "Play"}
            <span className="sr-only">
              {animating
                ? ` — on. The comparison is animating at ${speed}x speed. Activate to pause it. Shortcut: K.`
                : " — off. Activate to animate the comparison. Shortcut: K."}
            </span>
          </Button>
          <Button
            ref={staticBtnRef}
            id="audioscope-compare-static-toggle"
            {...{ [PANE_ANCHOR_ATTR]: "compare" }}
            size="sm"
            variant="ghost"
            className={isStatic ? TRANSPORT_CLS_ACTIVE : TRANSPORT_CLS}
            onClick={toggleStatic}
            aria-pressed={isStatic}
            aria-keyshortcuts="S"
            aria-describedby={
              reducedMotion
                ? "audioscope-compare-motion-notice audioscope-compare-shortcut-hint audioscope-compare-status"
                : "audioscope-compare-shortcut-hint audioscope-compare-status"
            }
          >
            <ImageIcon className="h-3 w-3" aria-hidden />
            Static
            <span className="sr-only">
              {isStatic
                ? ` — on. Showing one still frame at ${STATIC_FRAME_T.toFixed(2)} seconds. Activate to resume motion. Shortcut: S.`
                : " — off. Activate to freeze the comparison on a single still frame. Shortcut: S."}
            </span>
          </Button>


          <div className="flex h-7 items-center gap-1.5 rounded-md border border-border/40 bg-background/30 px-2 backdrop-blur-sm">
            <Gauge className="h-3 w-3 text-muted-foreground/70" aria-hidden />
            <label className="sr-only" htmlFor="audioscope-compare-speed">
              Comparison animation speed
            </label>
            <select
              id="audioscope-compare-speed"
              value={String(speed)}
              disabled={isStatic}
              onChange={(e) => setSpeed(Number(e.target.value))}
              className="bg-transparent text-[11px] text-muted-foreground outline-none disabled:opacity-50"
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
            variant="ghost"
            className={showLegend ? TRANSPORT_CLS_ACTIVE : TRANSPORT_CLS}
            onClick={() => setShowLegend((v) => !v)}
            aria-expanded={showLegend}
          >
            <Info className="h-3 w-3" aria-hidden />
            <span className="hidden sm:inline">How to read this</span>

          </Button>
        </div>
      </div>

      <div className="p-4">
        <p
          id="audioscope-compare-shortcut-hint"
          className="mb-2 text-[11px] text-muted-foreground"
        >
          {SHORTCUT_HINT}
        </p>

        {/* Announces mode changes to screen readers without moving focus. */}
        <p id="audioscope-compare-status" aria-live="polite" className="sr-only">
          {isStatic
            ? `Comparison is static — one frame at ${STATIC_FRAME_T.toFixed(2)} seconds.`
            : playing
            ? `Comparison is animating at ${speed}x speed.`
            : "Comparison is paused."}
        </p>
        {reducedMotion ? (
          <div
            id="audioscope-compare-motion-notice"
            role="note"
            aria-labelledby="audioscope-compare-motion-title"
            className="mb-3 flex items-start gap-2 rounded-lg border border-primary/40 bg-primary/5 p-3 text-xs text-muted-foreground"
          >
            <Accessibility className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
            <div>
              <p>
                <span id="audioscope-compare-motion-title" className="font-semibold text-foreground">
                  Reduced motion is on.
                </span>{" "}
                Because your system requests <em>prefers-reduced-motion</em>, this comparison starts
                as a static frame at t = {STATIC_FRAME_T.toFixed(2)}s. Press <strong>Play</strong> to
                animate it — the divergence band and Δ values are identical either way.
              </p>
              <Button
                size="sm"
                variant="link"
                className="h-auto p-0 text-xs focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                aria-keyshortcuts="M"
                onClick={() => focusMotionControls(rootRef.current)}
              >
                Jump to motion controls (M)
              </Button>

            </div>
          </div>
        ) : null}

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
