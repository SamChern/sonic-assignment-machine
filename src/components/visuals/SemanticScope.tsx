/**
 * The Semantic Scope — one signal, three synchronized lenses.
 *
 *   1. Time lens      — the existing waveform (Audioscope, unchanged: it's the brand).
 *   2. Frequency lens — a scrolling spectrogram strip with Meyda feature
 *                       ribbons (RMS = energy, spectral centroid = brightness).
 *   3. Meaning lens   — the six-axis radial plus the taxonomy tags that light up
 *                       when the current window is scored through CLAP + kNN.
 *
 * All three read the *same* provider: the time lens owns the animation loop and
 * hands its buffers to the others via `onFrame`, so nothing double-analyses the
 * audio and nothing drifts out of sync. For Intuizi subjects with no audio at
 * all, the provider is a deterministic silhouette synthesized from the
 * tag-weighted embedding, so the instrument reads identically.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Info, Waves, Radar, Tags, Bug, Loader2 } from "lucide-react";
import Audioscope from "./Audioscope";
import ScopeTrail from "./ScopeTrail";
import WaveInspect from "./WaveInspect";
import { ScopeDebugDrawer, ScopeLegend } from "./ScopeDrawers";
import {
  AUDIOSCOPE_CATEGORIES,
  CATEGORY_LABELS,
  categoryToken,
  type AudioscopeFeatureHints,
  type CategoryScores,
} from "@/lib/audioscope";
import { FeatureWindow, extractFeatures, type ScopeFeatures } from "@/lib/audioscope/features";
import { ScrollingSpectrogram } from "@/lib/audioscope/spectrogram";
import type { SilhouetteTag } from "@/lib/audioscope/silhouette";
import { formatTrailTime, type TrailEntry } from "@/lib/audioscope/trail";
import { useAudioscopeSignal } from "@/lib/audioscope/useSignal";
import {
  useScopeWindowScore,
  useScopeWindowSeconds,
  type ScopeTag,
} from "@/hooks/useScopeWindowScore";

export type ScopeLens = "consumer" | "enterprise" | "debug";

interface SemanticScopeProps {
  scores: CategoryScores;
  seed: string;
  features?: AudioscopeFeatureHints | null;
  /** Playable audio; absent for Intuizi subjects (zero-audio silhouette). */
  mediaEl?: HTMLMediaElement | null;
  /** Tag mix used to synthesize the silhouette when there is no audio. */
  tags?: SilhouetteTag[] | null;
  playing?: boolean;
  speed?: number;
  staticFrame?: number | null;
  height?: number;
  /** Role lens: consumer (play + labels), enterprise (compare), admin (debug). */
  lens?: ScopeLens;
  caption?: string;
  subjectRef?: string;
}

function readVar(name: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v ? `hsl(${v})` : fallback;
}

/** Resample the scope's display buffer to a Meyda-sized power-of-two frame. */
function toFeatureFrame(wave: Float32Array, size: number): Float32Array {
  const out = new Float32Array(size);
  for (let i = 0; i < size; i++) {
    out[i] = wave[Math.floor((i / size) * wave.length)] ?? 0;
  }
  return out;
}

/** Centroid straight off the spectrum — the fallback when Meyda can't run. */
function spectrumBrightness(spec: Float32Array): { brightness: number; energy: number } {
  let num = 0;
  let den = 0;
  let sq = 0;
  for (let i = 0; i < spec.length; i++) {
    const m = spec[i];
    num += m * i;
    den += m;
    sq += m * m;
  }
  const centroidRatio = den > 0 ? num / den / spec.length : 0;
  return {
    brightness: Math.max(0, Math.min(1, centroidRatio)),
    energy: Math.max(0, Math.min(1, Math.sqrt(sq / Math.max(1, spec.length)))),
  };
}

export const SemanticScope = ({
  scores,
  seed,
  features = null,
  mediaEl = null,
  tags = null,
  playing = true,
  speed = 1,
  staticFrame = null,
  height = 300,
  lens = "consumer",
  caption,
  subjectRef,
}: SemanticScopeProps) => {
  const stripRef = useRef<HTMLCanvasElement | null>(null);
  const gramRef = useRef<ScrollingSpectrogram | null>(null);
  const windowRef = useRef(new FeatureWindow());
  const [live, setLive] = useState<ScopeFeatures | null>(null);
  const [showLegend, setShowLegend] = useState(false);
  const [showDebug, setShowDebug] = useState(false);
  const lastMarkerRef = useRef<number>(0);

  const windowSeconds = useScopeWindowSeconds();
  const signal = useAudioscopeSignal({ scores, seed, features, mediaEl, tags });
  const isSilhouette = !mediaEl;

  const { tags: litTags, markers, debug, status, score, reset } = useScopeWindowScore({
    enabled: Boolean(playing) && staticFrame == null,
    windowSeconds,
    subjectRef: subjectRef ?? seed,
  });

  useEffect(() => {
    reset();
    windowRef.current.reset();
    gramRef.current?.clear();
  }, [seed, reset]);

  // Frequency lens canvas.
  useEffect(() => {
    const canvas = stripRef.current;
    if (!canvas) return;
    // Environments without a 2d context (headless tests, locked-down browsers)
    // simply lose the strip; the other two lenses keep working.
    let gram: ScrollingSpectrogram;
    try {
      gram = new ScrollingSpectrogram(canvas, {
        bg: readVar("--background", "#06121a"),
        grid: readVar("--border", "#1f2937"),
        cats: AUDIOSCOPE_CATEGORIES.map((c) => readVar(`--category-${c}`, "#14b8a6")),
        energy: readVar("--primary", "#14b8a6"),
        brightness: readVar("--muted-foreground", "#94a3b8"),
      });
    } catch {
      return;
    }
    gramRef.current = gram;
    const onResize = () => gram.resize();
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      gramRef.current = null;
    };
  }, []);

  /**
   * One callback per painted frame: push a spectrogram column, accumulate the
   * Meyda window, and — once the window closes — score it through the meaning
   * lens. Deliberately allocation-light; it runs at frame rate.
   */
  const handleFrame = useCallback(
    (t: number, wave: Float32Array, spectrum: Float32Array) => {
      const meyda = extractFeatures(toFeatureFrame(wave, 512));
      const fallback = spectrumBrightness(spectrum);
      const frame: ScopeFeatures = meyda ?? {
        rms: fallback.energy,
        centroidBin: 0,
        centroidHz: fallback.brightness * 4000,
        brightness: fallback.brightness,
        chroma: [],
      };
      windowRef.current.push(frame);

      const justFired = t - lastMarkerRef.current < 0.35 && lastMarkerRef.current > 0;
      gramRef.current?.push({
        spectrum,
        energy: frame.rms,
        brightness: frame.brightness,
        marker: justFired,
      });

      // Throttle React state to ~6 Hz; the canvas already carries the detail.
      if (Math.floor(t * 6) !== Math.floor((t - 0.016) * 6)) setLive(frame);

      if (t - lastMarkerRef.current >= windowSeconds) {
        const summary = windowRef.current.summary();
        windowRef.current.reset();
        lastMarkerRef.current = t;
        if (summary) void score(summary, scores, t);
      }
    },
    [score, scores, windowSeconds],
  );

  const axisRows = useMemo(
    () =>
      AUDIOSCOPE_CATEGORIES.map((c) => ({
        category: c,
        score: Math.round(Number(scores[c]) || 0),
      })),
    [scores],
  );

  return (
    <div className="space-y-3">
      {/* Lens 1 — time. The waveform itself is unchanged. */}
      <Audioscope
        scores={scores}
        seed={seed}
        features={features}
        mode="scope"
        playing={playing}
        speed={speed}
        staticFrame={staticFrame}
        signal={signal}
        onFrame={handleFrame}
        height={height}
        caption={caption}
      />

      {/* Lens 2 — frequency. */}
      <div className="rounded-xl border border-border/60 bg-background/60 p-2">
        <div className="mb-1 flex items-center justify-between gap-2 px-1">
          <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
            <Waves className="h-3 w-3 text-primary" aria-hidden />
            Frequency lens
          </span>
          <span className="flex items-center gap-2 text-[10px] text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <span aria-hidden className="h-0.5 w-3 bg-primary" />
              energy {live ? (live.rms * 100).toFixed(0) : "--"}
            </span>
            <span className="inline-flex items-center gap-1">
              <span aria-hidden className="h-0.5 w-3 bg-muted-foreground" />
              brightness {live ? `${Math.round(live.centroidHz)} Hz` : "--"}
            </span>
          </span>
        </div>
        <canvas
          ref={stripRef}
          role="img"
          aria-label="Scrolling spectrogram with energy and brightness traces"
          className="h-[72px] w-full rounded-lg"
          style={{ height: 72 }}
        />
      </div>

      {/* Lens 3 — meaning. */}
      <div className="grid gap-3 rounded-xl border border-border/60 bg-background/60 p-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <div>
          <span className="mb-2 inline-flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
            <Radar className="h-3 w-3 text-primary" aria-hidden />
            Meaning lens · six-axis ontology
          </span>
          <Audioscope
            scores={scores}
            seed={`${seed}-meaning`}
            features={features}
            mode="radial"
            playing={playing}
            speed={speed}
            staticFrame={staticFrame}
            signal={signal}
            height={168}
          />
          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
            {axisRows.map((r) => (
              <span key={r.category} className="inline-flex items-center gap-1.5 text-[10px] text-muted-foreground">
                <span
                  aria-hidden
                  className="h-2 w-2 rounded-full"
                  style={{ background: categoryToken(r.category) }}
                />
                {CATEGORY_LABELS[r.category]} {r.score}
              </span>
            ))}
          </div>
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
              <Tags className="h-3 w-3 text-primary" aria-hidden />
              Tags lighting up · every {windowSeconds}s
            </span>
            <span className="flex items-center gap-1.5">
              {status === "scoring" ? (
                <Loader2 className="h-3 w-3 animate-spin text-primary" aria-hidden />
              ) : null}
              <Button
                size="sm"
                variant="ghost"
                className="h-6 px-1.5 text-[10px]"
                onClick={() => setShowLegend((v) => !v)}
                aria-expanded={showLegend}
              >
                <Info className="h-3 w-3" aria-hidden />
                Legend
              </Button>
              {lens === "debug" ? (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 px-1.5 text-[10px]"
                  onClick={() => setShowDebug((v) => !v)}
                  aria-expanded={showDebug}
                >
                  <Bug className="h-3 w-3" aria-hidden />
                  Debug
                </Button>
              ) : null}
            </span>
          </div>

          {status === "unconfigured" ? (
            <p className="text-[11px] text-muted-foreground">
              The semantic service isn&apos;t configured, so tags can&apos;t be matched right now —
              the time and frequency lenses still run.
            </p>
          ) : litTags.length === 0 ? (
            <p className="text-[11px] text-muted-foreground">
              {playing && staticFrame == null
                ? "Listening — the first window scores in a moment."
                : "Press play to score the audio window by window."}
            </p>
          ) : (
            <ul className="space-y-1.5">
              {litTags.slice(0, 6).map((t: ScopeTag) => (
                <li key={t.id ?? t.code} className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-[11px] text-foreground">{t.label}</span>
                  <span
                    aria-hidden
                    className="h-1.5 rounded-full bg-primary"
                    style={{ width: `${Math.max(6, Math.round(t.similarity * 64))}px`, opacity: 0.35 + t.similarity * 0.65 }}
                  />
                  <span className="w-9 text-right text-[10px] tabular-nums text-muted-foreground">
                    {(t.similarity * 100).toFixed(0)}%
                  </span>
                </li>
              ))}
            </ul>
          )}

          {markers.length ? (
            <p className="mt-2 text-[10px] text-muted-foreground">
              {markers.length} scored window{markers.length === 1 ? "" : "s"} this session · latest{" "}
              <span className="text-foreground">{markers[markers.length - 1].label}</span>
            </p>
          ) : null}

          <Badge variant="secondary" className="mt-2 text-[10px]">
            {isSilhouette ? "Expected sonic silhouette (no audio)" : "Real audio signal"}
          </Badge>
        </div>
      </div>

      {showLegend ? (
        <div className="grid gap-3 rounded-xl border border-border/60 bg-background/60 p-3 text-[11px] leading-relaxed text-muted-foreground sm:grid-cols-3">
          <div>
            <p className="mb-1 font-semibold text-foreground">Time lens</p>
            <p>The waveform: amplitude over time, one harmonic band per ontology category.</p>
          </div>
          <div>
            <p className="mb-1 font-semibold text-foreground">Frequency lens</p>
            <p>
              The strip scrolls right to left — low frequencies at the bottom, colored by the
              category band they feed. The teal trace is <strong>energy</strong> (RMS), the grey one{" "}
              <strong>brightness</strong> (spectral centroid). Vertical ticks mark windows that
              produced a tag.
            </p>
          </div>
          <div>
            <p className="mb-1 font-semibold text-foreground">Meaning lens</p>
            <p>
              Every {windowSeconds} seconds the current window is embedded and matched against the
              taxonomy; the nearest tags light up with their similarity and the radial morphs.
              {isSilhouette
                ? " With no audio, the trace is the subject's expected silhouette synthesized from their tag-weighted embedding."
                : ""}
            </p>
          </div>
        </div>
      ) : null}

      {lens === "debug" && showDebug ? (
        <div className="rounded-xl border border-primary/40 bg-primary/5 p-3 text-[11px] text-muted-foreground">
          <p className="mb-1 font-semibold text-foreground">Debug lens</p>
          {debug ? (
            <div className="grid gap-2 sm:grid-cols-2">
              <div>
                <p>
                  kNN k = <span className="text-foreground">{debug.knn_k}</span> · prior blend ={" "}
                  <span className="text-foreground">{debug.prior_blend_weight}</span> · bridge ={" "}
                  <span className="text-foreground">{debug.bridge_active_id ?? "none"}</span>
                </p>
                <p className="mt-1">
                  window RMS <span className="text-foreground">{debug.features.rms.toFixed(3)}</span> ·
                  centroid <span className="text-foreground">{Math.round(debug.features.centroidHz)} Hz</span>
                </p>
              </div>
              <ul className="space-y-0.5">
                {debug.neighbors.slice(0, 8).map((n) => (
                  <li key={n.id ?? n.code} className="flex justify-between gap-2">
                    <span className="truncate font-mono text-[10px]">{n.code}</span>
                    <span className="tabular-nums text-foreground">{n.similarity.toFixed(3)}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p>No scored window yet — press play to retrieve neighbors.</p>
          )}
        </div>
      ) : null}
    </div>
  );
};

export default SemanticScope;
