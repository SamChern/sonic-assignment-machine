import { useEffect, useRef, useMemo } from "react";
import { Card } from "@/components/ui/card";
import type { LibrosaFeatures } from "@/hooks/useLibrosaFeatures";

interface Props {
  features: LibrosaFeatures;
}

// Convert "168 76% 42%" (semantic-token style) into [r,g,b] 0-255.
// Falls back to a neutral mid-grey if parsing fails.
function hslStringToRgb(hsl: string): [number, number, number] {
  const m = hsl.trim().match(/^(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)%\s+(\d+(?:\.\d+)?)%$/);
  if (!m) return [128, 128, 128];
  const h = parseFloat(m[1]) / 360;
  const s = parseFloat(m[2]) / 100;
  const l = parseFloat(m[3]) / 100;
  const hue2rgb = (p: number, q: number, t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  let r: number, g: number, b: number;
  if (s === 0) {
    r = g = b = l;
  } else {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1 / 3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1 / 3);
  }
  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}

function readToken(name: string): string {
  if (typeof window === "undefined") return "";
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

// Heatmap painter — magnitude in [0,1] -> blend along a viridis-like ramp
// derived from the project's semantic category tokens (cohesive with the rest
// of the app).
function makeRamp(): [number, number, number][] {
  const stops = [
    "--background",
    "--category-emotional",
    "--category-cognitive",
    "--category-artistic",
    "--category-communication",
  ].map(readToken).map(hslStringToRgb);
  return stops;
}

function sampleRamp(ramp: [number, number, number][], t: number): [number, number, number] {
  const x = Math.max(0, Math.min(1, t)) * (ramp.length - 1);
  const i = Math.floor(x);
  const f = x - i;
  const a = ramp[i];
  const b = ramp[Math.min(ramp.length - 1, i + 1)];
  return [
    Math.round(a[0] + (b[0] - a[0]) * f),
    Math.round(a[1] + (b[1] - a[1]) * f),
    Math.round(a[2] + (b[2] - a[2]) * f),
  ];
}

function paintHeatmap(
  canvas: HTMLCanvasElement,
  matrix: number[][],
  opts: { invertY?: boolean } = {},
) {
  const rows = matrix.length;
  const cols = matrix[0]?.length ?? 0;
  if (!rows || !cols) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const dpr = window.devicePixelRatio || 1;
  const cssW = canvas.clientWidth;
  const cssH = canvas.clientHeight;
  canvas.width = Math.floor(cssW * dpr);
  canvas.height = Math.floor(cssH * dpr);
  ctx.scale(dpr, dpr);

  // Normalize values to [0,1] over the whole matrix
  let lo = Infinity, hi = -Infinity;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const v = matrix[r][c];
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
  }
  const range = hi - lo || 1;
  const ramp = makeRamp();

  const cellW = cssW / cols;
  const cellH = cssH / rows;

  for (let r = 0; r < rows; r++) {
    const rr = opts.invertY ? rows - 1 - r : r;
    for (let c = 0; c < cols; c++) {
      const t = (matrix[rr][c] - lo) / range;
      const [R, G, B] = sampleRamp(ramp, t);
      ctx.fillStyle = `rgb(${R},${G},${B})`;
      ctx.fillRect(c * cellW, r * cellH, Math.ceil(cellW) + 0.5, Math.ceil(cellH) + 0.5);
    }
  }
}

// ---------------------------------------------------------------------------
// MFCC heatmap with beat overlay + onset envelope sparkline
// ---------------------------------------------------------------------------
function MfccPanel({ features }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<SVGSVGElement>(null);
  const { mfcc, times, beat_times, onset_envelope } = features.visuals;

  useEffect(() => {
    if (canvasRef.current) paintHeatmap(canvasRef.current, mfcc, { invertY: true });
  }, [mfcc]);

  const tStart = times[0] ?? 0;
  const tEnd = times[times.length - 1] ?? features.duration_sec;
  const span = Math.max(1e-3, tEnd - tStart);

  const onsetMax = useMemo(
    () => Math.max(1e-3, ...onset_envelope),
    [onset_envelope],
  );

  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between">
        <h4 className="text-sm font-semibold">MFCC + beats</h4>
        <span className="text-xs text-muted-foreground">
          {features.scalars.tempo_bpm.toFixed(1)} BPM · {beat_times.length} beats
        </span>
      </div>
      {/* Onset sparkline */}
      <svg viewBox="0 0 100 16" className="w-full h-8 text-primary" preserveAspectRatio="none">
        <polyline
          points={onset_envelope
            .map((v, i) => `${(i / (onset_envelope.length - 1)) * 100},${16 - (v / onsetMax) * 14}`)
            .join(" ")}
          fill="none"
          stroke="currentColor"
          strokeWidth="0.6"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <div className="relative h-40 w-full rounded-md overflow-hidden border border-border">
        <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />
        <svg
          ref={overlayRef}
          className="absolute inset-0 w-full h-full pointer-events-none"
          preserveAspectRatio="none"
          viewBox="0 0 100 100"
        >
          {beat_times.map((t, i) => {
            const x = ((t - tStart) / span) * 100;
            if (x < 0 || x > 100) return null;
            return (
              <line
                key={i}
                x1={x}
                x2={x}
                y1={0}
                y2={100}
                stroke="hsl(var(--foreground))"
                strokeWidth="0.15"
                opacity={0.55}
                vectorEffect="non-scaling-stroke"
              />
            );
          })}
        </svg>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Chromagram + tonnetz radial
// ---------------------------------------------------------------------------
const PITCH_CLASSES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const TONNETZ_AXES = ["5th-x", "5th-y", "min3-x", "min3-y", "maj3-x", "maj3-y"];

export function ChromaTonnetzPanel({ features }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { chroma } = features.visuals;
  const { tonnetz_mean, estimated_key, mode } = features.scalars;

  useEffect(() => {
    if (canvasRef.current) paintHeatmap(canvasRef.current, chroma, { invertY: true });
  }, [chroma]);

  // Tonnetz radial — values are typically in [-1, 1]; normalize to a unit
  // radius around the centre.
  const size = 180;
  const cx = size / 2;
  const cy = size / 2;
  const maxR = 70;
  const points = tonnetz_mean.map((v, i) => {
    const angle = (i / tonnetz_mean.length) * Math.PI * 2 - Math.PI / 2;
    const r = (Math.abs(v) * 0.8 + 0.2) * maxR;
    return { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle), v, angle };
  });
  const path =
    points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ") + " Z";

  return (
    <div className="grid gap-4 md:grid-cols-[1fr_200px]">
      <div className="space-y-2">
        <div className="flex items-baseline justify-between">
          <h4 className="text-sm font-semibold">Chromagram</h4>
          <span className="text-xs text-muted-foreground">
            Key: {estimated_key} {mode}
          </span>
        </div>
        <div className="relative h-40 w-full rounded-md overflow-hidden border border-border">
          <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />
        </div>
        <div className="grid grid-cols-12 text-[10px] text-muted-foreground text-center">
          {PITCH_CLASSES.map(p => <div key={p}>{p}</div>)}
        </div>
      </div>
      <div className="flex flex-col items-center">
        <h4 className="text-sm font-semibold mb-1">Tonnetz</h4>
        <svg width={size} height={size}>
          {[0.25, 0.5, 0.75, 1].map(p => (
            <circle key={p} cx={cx} cy={cy} r={maxR * p} fill="none"
              stroke="hsl(var(--border))" opacity={0.4} />
          ))}
          {points.map((p, i) => (
            <line key={i} x1={cx} y1={cy} x2={cx + maxR * Math.cos(p.angle)}
              y2={cy + maxR * Math.sin(p.angle)} stroke="hsl(var(--border))" opacity={0.3} />
          ))}
          <path d={path} fill="hsl(var(--primary) / 0.25)" stroke="hsl(var(--primary))" strokeWidth={1.5} />
          {points.map((p, i) => (
            <g key={i}>
              <circle cx={p.x} cy={p.y} r={3} fill="hsl(var(--primary))" />
              <text x={cx + (maxR + 12) * Math.cos(p.angle)}
                    y={cy + (maxR + 12) * Math.sin(p.angle)}
                    textAnchor="middle" dominantBaseline="middle"
                    className="fill-muted-foreground text-[8px]">
                {TONNETZ_AXES[i]}
              </text>
            </g>
          ))}
        </svg>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Self-similarity matrix + segments
// ---------------------------------------------------------------------------
function RecurrencePanel({ features }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { recurrence, segment_times } = features.visuals;
  const duration = features.duration_sec;

  useEffect(() => {
    if (canvasRef.current) paintHeatmap(canvasRef.current, recurrence);
  }, [recurrence]);

  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between">
        <h4 className="text-sm font-semibold">Self-similarity</h4>
        <span className="text-xs text-muted-foreground">
          {segment_times.length} segments · {Math.round(duration)}s
        </span>
      </div>
      <div className="relative aspect-square w-full max-w-md mx-auto rounded-md overflow-hidden border border-border">
        <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />
        <svg className="absolute inset-0 w-full h-full pointer-events-none"
             preserveAspectRatio="none" viewBox="0 0 100 100">
          {segment_times.map((t, i) => {
            const p = (t / Math.max(duration, 1e-3)) * 100;
            return (
              <g key={i}>
                <line x1={p} x2={p} y1={0} y2={100}
                      stroke="hsl(var(--foreground))" opacity={0.4} strokeWidth="0.2"
                      vectorEffect="non-scaling-stroke" />
                <line x1={0} x2={100} y1={p} y2={p}
                      stroke="hsl(var(--foreground))" opacity={0.4} strokeWidth="0.2"
                      vectorEffect="non-scaling-stroke" />
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Top-level grid
// ---------------------------------------------------------------------------
export function LibrosaVisuals({ features }: Props) {
  const s = features.scalars;
  return (
    <Card className="p-4 space-y-6 border-border/60">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 text-xs">
        <Stat label="Tempo" value={`${s.tempo_bpm.toFixed(1)} BPM`} />
        <Stat label="Key" value={`${s.estimated_key} ${s.mode}`} />
        <Stat label="Beat regularity" value={s.beat_regularity.toFixed(2)} />
        <Stat label="Onset rate" value={`${s.onset_rate_per_sec.toFixed(2)}/s`} />
        <Stat label="RMS energy" value={s.rms_mean.toFixed(3)} />
        <Stat label="Spectral centroid" value={`${Math.round(s.spectral_centroid_mean)} Hz`} />
        <Stat label="Spectral flatness" value={s.spectral_flatness_mean.toFixed(3)} />
        <Stat label="Zero-crossing" value={s.zero_crossing_rate_mean.toFixed(3)} />
      </div>
      <MfccPanel features={features} />
      <ChromaTonnetzPanel features={features} />
      <RecurrencePanel features={features} />
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-muted/30 px-3 py-2">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="font-mono text-sm">{value}</div>
    </div>
  );
}
