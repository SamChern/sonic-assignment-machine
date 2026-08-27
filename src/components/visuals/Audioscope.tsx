import { useEffect, useMemo, useRef } from "react";
import {
  AUDIOSCOPE_CATEGORIES,
  CATEGORY_LABELS,
  createLiveAudioSignal,
  createSyntheticSignal,
  type AudioscopeFeatureHints,
  type AudioscopeSignal,
  type CategoryScores,
} from "@/lib/audioscope";

export type AudioscopeMode = "scope" | "radial" | "nodes";

interface AudioscopeProps {
  scores: CategoryScores;
  seed?: string;
  features?: AudioscopeFeatureHints | null;
  mode?: AudioscopeMode;
  playing?: boolean;
  /** Animation rate multiplier (1 = realtime). */
  speed?: number;
  /**
   * When set, the scope renders one deterministic frame at this time offset and
   * never animates ("Static" view). Overrides `playing`.
   */
  staticFrame?: number | null;
  /** When provided (and playable), the scope is driven by real audio. */
  mediaEl?: HTMLMediaElement | null;
  height?: number;
  className?: string;
  /** Corner caption drawn inside the canvas. */
  caption?: string;
}

function readVar(name: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v ? `hsl(${v})` : fallback;
}

export const Audioscope = ({
  scores,
  seed = "sonicsim",
  features = null,
  mode = "scope",
  playing = true,
  speed = 1,
  staticFrame = null,
  mediaEl = null,
  height = 320,
  className,
  caption,
}: AudioscopeProps) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const signalRef = useRef<AudioscopeSignal | null>(null);
  const visibleRef = useRef(true);
  const startRef = useRef<number>(0);
  const elapsedRef = useRef<number>(0);

  const reduced = useMemo(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches,
    [],
  );
  const isMobile = useMemo(
    () => typeof window !== "undefined" && window.innerWidth < 640,
    [],
  );

  // Build (or rebuild) the signal provider.
  useEffect(() => {
    signalRef.current?.dispose();
    let signal: AudioscopeSignal | null = null;
    if (mediaEl) {
      try {
        signal = createLiveAudioSignal(mediaEl);
      } catch {
        signal = null;
      }
    }
    // Falls back to the synthesized scope so the view never renders empty.
    signalRef.current = signal ?? createSyntheticSignal({ scores, seed, features });
    return () => {
      signalRef.current?.dispose();
      signalRef.current = null;
    };
  }, [mediaEl, scores, seed, features]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const points = isMobile ? 320 : 720;
    const bins = isMobile ? 48 : 96;
    const wave = new Float32Array(points);
    const spec = new Float32Array(bins);

    const colors = {
      bg: readVar("--background", "#06121a"),
      grid: readVar("--border", "#1f2937"),
      primary: readVar("--primary", "#14b8a6"),
      muted: readVar("--muted-foreground", "#94a3b8"),
      cats: AUDIOSCOPE_CATEGORIES.map((c) => readVar(`--category-${c}`, "#14b8a6")),
    };

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = canvas.clientWidth || 600;
      const h = canvas.clientHeight || height;
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener("resize", resize);

    const io = new IntersectionObserver(
      (entries) => {
        visibleRef.current = entries[0]?.isIntersecting ?? true;
      },
      { threshold: 0.05 },
    );
    io.observe(canvas);

    const paintBackground = (w: number, h: number) => {
      const grad = ctx.createLinearGradient(0, 0, w, h);
      grad.addColorStop(0, colors.bg);
      grad.addColorStop(1, colors.grid);
      ctx.globalAlpha = 1;
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);
      ctx.globalAlpha = 0.18;
      ctx.strokeStyle = colors.grid;
      ctx.lineWidth = 1;
      const step = Math.max(28, Math.round(w / 18));
      for (let x = step; x < w; x += step) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
        ctx.stroke();
      }
      for (let y = step; y < h; y += step) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    };

    const drawScope = (w: number, h: number, t: number) => {
      const signal = signalRef.current!;
      signal.waveform(wave, t);
      signal.spectrum(spec, t);

      // Spectrum floor
      const barW = w / spec.length;
      for (let i = 0; i < spec.length; i++) {
        const cat = colors.cats[Math.floor((i / spec.length) * colors.cats.length)];
        const bh = spec[i] * h * 0.42;
        ctx.globalAlpha = 0.22;
        ctx.fillStyle = cat;
        ctx.fillRect(i * barW, h - bh, Math.max(1, barW - 1), bh);
      }
      ctx.globalAlpha = 1;

      // Horizon
      ctx.strokeStyle = colors.primary;
      ctx.globalAlpha = 0.15;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, h / 2);
      ctx.lineTo(w, h / 2);
      ctx.stroke();
      ctx.globalAlpha = 1;

      // Glow trail + trace
      const drawTrace = (alpha: number, width: number) => {
        ctx.globalAlpha = alpha;
        ctx.lineWidth = width;
        ctx.strokeStyle = colors.primary;
        ctx.beginPath();
        for (let i = 0; i < wave.length; i++) {
          const x = (i / (wave.length - 1)) * w;
          const y = h / 2 + wave[i] * (h * 0.38);
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
        ctx.globalAlpha = 1;
      };
      drawTrace(0.18, 8);
      drawTrace(0.95, 2);
    };

    const drawRadial = (w: number, h: number, t: number) => {
      const signal = signalRef.current!;
      signal.waveform(wave, t);
      const bands = signal.bands(t);
      const cx = w / 2;
      const cy = h / 2;
      const base = Math.min(w, h) * 0.28;

      // Category petals
      AUDIOSCOPE_CATEGORIES.forEach((c, i) => {
        const a0 = (Math.PI * 2 * i) / AUDIOSCOPE_CATEGORIES.length - Math.PI / 2;
        const a1 = (Math.PI * 2 * (i + 1)) / AUDIOSCOPE_CATEGORIES.length - Math.PI / 2;
        const r = base * (0.55 + bands[c] * 0.9);
        ctx.globalAlpha = 0.16 + bands[c] * 0.25;
        ctx.fillStyle = colors.cats[i];
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.arc(cx, cy, r, a0, a1);
        ctx.closePath();
        ctx.fill();
      });
      ctx.globalAlpha = 1;

      // Waveform ring
      const ring = (alpha: number, width: number) => {
        ctx.globalAlpha = alpha;
        ctx.lineWidth = width;
        ctx.strokeStyle = colors.primary;
        ctx.beginPath();
        for (let i = 0; i < wave.length; i++) {
          const a = (i / wave.length) * Math.PI * 2 - Math.PI / 2;
          const r = base * 1.35 + wave[i] * base * 0.42;
          const x = cx + r * Math.cos(a);
          const y = cy + r * Math.sin(a);
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.closePath();
        ctx.stroke();
        ctx.globalAlpha = 1;
      };
      ring(0.2, 9);
      ring(0.9, 2);
    };

    const drawNodes = (w: number, h: number, t: number) => {
      const signal = signalRef.current!;
      const bands = signal.bands(t);
      signal.waveform(wave, t);
      const cx = w / 2;
      const cy = h / 2;
      const radius = Math.min(w, h) * 0.33;

      const nodes = AUDIOSCOPE_CATEGORIES.map((c, i) => {
        const a = (Math.PI * 2 * i) / AUDIOSCOPE_CATEGORIES.length - Math.PI / 2;
        const breathe = 1 + bands[c] * 0.14;
        return {
          c,
          i,
          x: cx + radius * breathe * Math.cos(a),
          y: cy + radius * breathe * Math.sin(a),
          energy: bands[c],
          score: (Number(scores[c]) || 0) / 100,
        };
      });

      // Edges brighten with combined signal strength.
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const strength = (nodes[i].energy + nodes[j].energy) / 2;
          ctx.globalAlpha = 0.06 + strength * 0.4;
          ctx.lineWidth = 0.6 + strength * 2.4;
          ctx.strokeStyle = colors.primary;
          ctx.beginPath();
          ctx.moveTo(nodes[i].x, nodes[i].y);
          ctx.lineTo(nodes[j].x, nodes[j].y);
          ctx.stroke();
        }
      }
      ctx.globalAlpha = 1;

      // Central pulse fed by the waveform.
      const pulse = Math.abs(wave[Math.floor(wave.length / 2)] || 0);
      ctx.globalAlpha = 0.25 + pulse * 0.4;
      ctx.fillStyle = colors.primary;
      ctx.beginPath();
      ctx.arc(cx, cy, radius * 0.16 * (1 + pulse * 0.5), 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;

      nodes.forEach((n) => {
        const r = 7 + n.score * 16 + n.energy * 7;
        ctx.globalAlpha = 0.22 + n.energy * 0.3;
        ctx.fillStyle = colors.cats[n.i];
        ctx.beginPath();
        ctx.arc(n.x, n.y, r * 1.9, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.fillStyle = colors.cats[n.i];
        ctx.beginPath();
        ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
        ctx.fill();

        if (!isMobile) {
          ctx.fillStyle = colors.muted;
          ctx.font = "11px ui-monospace, monospace";
          ctx.textAlign = "center";
          ctx.fillText(CATEGORY_LABELS[n.c] ?? n.c, n.x, n.y - r - 7);
        }
      });
    };

    const frame = (t: number) => {
      const w = canvas.clientWidth || 600;
      const h = canvas.clientHeight || height;
      paintBackground(w, h);
      if (signalRef.current) {
        if (mode === "radial") drawRadial(w, h, t);
        else if (mode === "nodes") drawNodes(w, h, t);
        else drawScope(w, h, t);
      }
      if (caption) {
        ctx.globalAlpha = 0.75;
        ctx.fillStyle = colors.muted;
        ctx.font = "11px ui-monospace, monospace";
        ctx.textAlign = "left";
        ctx.fillText(caption, 12, 18);
        ctx.globalAlpha = 1;
      }
    };

    // Static view, reduced motion, or paused: render one frame and stop.
    if (staticFrame != null || reduced || !playing) {
      frame(staticFrame ?? elapsedRef.current);
      return () => {
        window.removeEventListener("resize", resize);
        io.disconnect();
      };
    }

    const rate = Math.max(0.1, Math.min(4, Number(speed) || 1));
    startRef.current = performance.now();
    let last = 0;
    let prev = performance.now();
    const minDelta = isMobile ? 1000 / 30 : 0;

    const loop = (now: number) => {
      rafRef.current = requestAnimationFrame(loop);
      if (!visibleRef.current) {
        prev = now;
        return;
      }
      if (now - last < minDelta) return;
      last = now;
      // Scaled accumulation keeps the clock continuous across speed changes.
      elapsedRef.current += ((now - prev) / 1000) * rate;
      prev = now;
      frame(elapsedRef.current);
    };
    rafRef.current = requestAnimationFrame(loop);

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      window.removeEventListener("resize", resize);
      io.disconnect();
    };
  }, [mode, playing, speed, staticFrame, reduced, isMobile, height, caption, scores]);

  return (
    <canvas
      ref={canvasRef}
      role="img"
      aria-label={caption ? `Audioscope visualization — ${caption}` : "Audioscope visualization"}
      className={className ?? "w-full rounded-xl border border-border/60 bg-background/60"}
      style={{ height }}
    />
  );
};

export default Audioscope;
