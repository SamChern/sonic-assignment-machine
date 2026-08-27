import { useEffect, useMemo, useRef, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Activity,
  Gauge,
  Info,
  Maximize2,
  Minimize2,
  Pause,
  Play,
  RotateCcw,
  Radar,
  Network,
  Image as ImageIcon,
  Accessibility,
} from "lucide-react";
import Audioscope, { type AudioscopeMode } from "./Audioscope";
import {
  AUDIOSCOPE_CATEGORIES,
  CATEGORY_LABELS,
  categoryToken,
  type AudioscopeFeatureHints,
  type CategoryScores,
} from "@/lib/audioscope";

export interface SonicSimSubject {
  id: string;
  label: string;
  sublabel?: string;
  scores: CategoryScores;
  /** Playable audio (upload blob URL or provider preview) — enables the real-audio scope. */
  audioUrl?: string | null;
  features?: AudioscopeFeatureHints | null;
}

interface SonicSimPanelProps {
  subjects: SonicSimSubject[];
  /** Fires whenever the visualized subject changes (used to pulse the network graph). */
  onSubjectChange?: (subject: SonicSimSubject | null) => void;
  title?: string;
  description?: string;
  defaultMode?: AudioscopeMode;
  height?: number;
}

const MODES: { key: AudioscopeMode; label: string; icon: typeof Activity }[] = [
  { key: "scope", label: "Scope", icon: Activity },
  { key: "radial", label: "Identity ring", icon: Radar },
  { key: "nodes", label: "Node pulse", icon: Network },
];

const prefersReducedMotion = () =>
  typeof window !== "undefined" &&
  Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);

const SPEEDS = [0.25, 0.5, 1, 1.5, 2, 3] as const;

/** Deterministic time offset (seconds) the Static view freezes on. */
const STATIC_FRAME_T = 1.25;

export const SonicSimPanel = ({
  subjects,
  onSubjectChange,
  title = "See my SonicSIM",
  description = "Play your sonic fingerprint, or any single semantic analysis, as a live audioscope.",
  defaultMode = "radial",
  height = 340,
}: SonicSimPanelProps) => {
  const [subjectId, setSubjectId] = useState<string>(subjects[0]?.id ?? "");
  const [mode, setMode] = useState<AudioscopeMode>(defaultMode);
  const [playing, setPlaying] = useState(() => !prefersReducedMotion());
  const [speed, setSpeed] = useState(0.25);
  // Reduced-motion users get the still frame by default; they can opt back into motion.
  const [isStatic, setIsStatic] = useState(prefersReducedMotion);
  const [reducedMotion, setReducedMotion] = useState(prefersReducedMotion);
  const [showLegend, setShowLegend] = useState(false);
  const [replayKey, setReplayKey] = useState(0);
  const [fullscreen, setFullscreen] = useState(false);
  const [liveEl, setLiveEl] = useState<HTMLMediaElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    if (!subjects.some((s) => s.id === subjectId)) setSubjectId(subjects[0]?.id ?? "");
  }, [subjects, subjectId]);

  const subject = useMemo(
    () => subjects.find((s) => s.id === subjectId) ?? subjects[0] ?? null,
    [subjects, subjectId],
  );

  // Per-band readout for the frozen frame: band order = category order (low to high).
  const staticBands = useMemo(() => {
    const scores = subject?.scores ?? ({} as CategoryScores);
    const rows = AUDIOSCOPE_CATEGORIES.map((c, i) => ({
      category: c,
      band: i + 1,
      score: Math.round(Number(scores[c]) || 0),
    }));
    const top = [...rows].sort((a, b) => b.score - a.score).slice(0, 2).map((r) => r.category);
    return rows.map((r) => ({ ...r, dominant: top.includes(r.category) }));
  }, [subject]);

  useEffect(() => {
    // Switching subject drops any previous real-audio routing.
    setLiveEl(null);
    audioRef.current?.pause();
  }, [subjectId]);

  useEffect(() => {
    onSubjectChange?.(subject ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subject?.id]);

  useEffect(() => {
    const mq = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (!mq) return;
    const onChange = () => setReducedMotion(mq.matches);
    mq.addEventListener?.("change", onChange);
    return () => mq.removeEventListener?.("change", onChange);
  }, []);

  useEffect(() => {
    const onChange = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const toggleStatic = () => {
    setIsStatic((prev) => {
      const next = !prev;
      if (next) {
        // Freezing the view also stops any real-audio routing.
        setPlaying(false);
        audioRef.current?.pause();
        setLiveEl(null);
      }
      return next;
    });
  };

  const togglePlay = async () => {
    const next = !playing;
    if (next) setIsStatic(false);
    setPlaying(next);
    const el = audioRef.current;
    if (!el || !subject?.audioUrl) return;
    if (next) {
      try {
        // AudioContext is created here — inside the user gesture.
        await el.play();
        setLiveEl(el);
      } catch {
        setLiveEl(null);
      }
    } else {
      el.pause();
    }
  };

  const toggleFullscreen = async () => {
    const node = wrapRef.current;
    if (!node) return;
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await node.requestFullscreen();
    } catch {
      /* fullscreen unavailable */
    }
  };

  if (!subject) {
    return (
      <Card className="border-border/60 bg-card/70 p-6 text-sm text-muted-foreground backdrop-blur-sm">
        Run a semantic analysis first — your SonicSIM visualization appears here once there are scores to play.
      </Card>
    );
  }

  return (
    <Card className="overflow-hidden border-border/60 bg-card/70 backdrop-blur-sm">
      <div className="flex flex-col gap-3 border-b border-border/50 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h3 className="flex items-center gap-2 text-base font-semibold text-foreground">
            <Activity className="h-4 w-4 text-primary" />
            {title}
          </h3>
          <p className="mt-1 text-xs text-muted-foreground sm:text-sm">{description}</p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" className="gap-1.5" onClick={togglePlay}>
            {playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
            {playing ? "Pause" : "Play"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5"
            onClick={() => setReplayKey((k) => k + 1)}
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Replay
          </Button>
          <Button
            size="sm"
            variant={isStatic ? "default" : "outline"}
            className="gap-1.5"
            onClick={toggleStatic}
            aria-pressed={isStatic}
            title="Freeze the audioscope on a single still frame"
          >
            <ImageIcon className="h-3.5 w-3.5" />
            Static
          </Button>
          <div className="flex items-center gap-1.5 rounded-md border border-border bg-muted/60 px-2 py-1">
            <Gauge className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
            <label className="sr-only" htmlFor="audioscope-speed">
              Animation speed
            </label>
            <select
              id="audioscope-speed"
              value={String(speed)}
              disabled={isStatic}
              onChange={(e) => setSpeed(Number(e.target.value))}
              className="bg-transparent text-xs text-foreground outline-none disabled:opacity-50"
            >
              {SPEEDS.map((v) => (
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
          <Button size="sm" variant="outline" className="gap-1.5" onClick={toggleFullscreen}>
            {fullscreen ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
            <span className="hidden sm:inline">{fullscreen ? "Exit" : "Present"}</span>
          </Button>
        </div>
      </div>

      <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
        <Select value={subjectId} onValueChange={setSubjectId}>
          <SelectTrigger className="w-full sm:w-72">
            <SelectValue placeholder="What to visualize" />
          </SelectTrigger>
          <SelectContent>
            {subjects.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {s.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="inline-flex flex-wrap gap-1 rounded-md border border-border bg-muted p-0.5">
          {MODES.map((m) => (
            <Button
              key={m.key}
              size="sm"
              variant={mode === m.key ? "default" : "ghost"}
              className="h-8 gap-1.5 text-xs"
              onClick={() => setMode(m.key)}
            >
              <m.icon className="h-3.5 w-3.5" />
              {m.label}
            </Button>
          ))}
        </div>

        <Badge variant="secondary" className="w-fit text-[11px]">
          {isStatic
            ? "Static frame"
            : subject.audioUrl
            ? liveEl
              ? "Real audio signal"
              : "Press play for real audio"
            : "Synthesized from fingerprint"}
        </Badge>
      </div>

      {reducedMotion ? (
        <div
          role="status"
          className="mx-4 mb-4 flex items-start gap-2 rounded-lg border border-primary/40 bg-primary/5 p-3 text-xs text-muted-foreground"
        >
          <Accessibility className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
          <p>
            <span className="font-semibold text-foreground">Reduced motion is on.</span> Your system
            setting (<em>prefers-reduced-motion</em>) asks apps to avoid animation, so the audioscope
            opens in <strong>Static</strong> — one still frame at t = {STATIC_FRAME_T.toFixed(2)}s
            instead of a moving trace. Press <strong>Play</strong> or turn off{" "}
            <strong>Static</strong> to animate it anyway; nothing is hidden either way.
          </p>
        </div>
      ) : null}

      <div ref={wrapRef} className="bg-background/40 px-4 pb-4">
        <Audioscope
          key={`${subject.id}-${mode}-${replayKey}`}
          scores={subject.scores}
          seed={subject.id}
          features={subject.features ?? null}
          mode={mode}
          playing={playing && !isStatic}
          speed={speed}
          staticFrame={isStatic ? STATIC_FRAME_T : null}
          mediaEl={liveEl}
          height={fullscreen ? Math.max(420, Math.round(window.innerHeight * 0.7)) : height}
          caption={subject.sublabel ?? subject.label}
        />

        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
          {AUDIOSCOPE_CATEGORIES.map((c) => (
            <span key={c} className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <span
                aria-hidden
                className="h-2 w-2 rounded-full"
                style={{ background: categoryToken(c) }}
              />
              {CATEGORY_LABELS[c]} {Math.round(Number(subject.scores[c]) || 0)}
            </span>
          ))}
        </div>

        {showLegend ? (
          <div className="mt-3 grid gap-3 rounded-xl border border-border/60 bg-background/60 p-4 text-xs leading-relaxed text-muted-foreground sm:grid-cols-3">
            <div>
              <p className="mb-1 font-semibold text-foreground">Where the signal comes from</p>
              <p>
                A <strong>sonic fingerprint</strong> is the average of every analysis on the
                six-category semantic layer; a <strong>single semantic analysis</strong> is one
                source&apos;s scores. Either set of six numbers (0-100) drives the animation.
              </p>
            </div>
            <div>
              <p className="mb-1 font-semibold text-foreground">Harmonic bands</p>
              <p>
                Each category becomes one harmonic partial: Emotional is the lowest band and
                Artistic the highest, in the legend order above. A category&apos;s score sets that
                partial&apos;s <em>amplitude</em> (how tall its wave and spectrum bar are) and its
                share of the identity ring. Higher overall energy and tempo hints widen and quicken
                the trace, so a bright, communication-heavy source visibly buzzes faster than a
                calm, contextual one.
              </p>
            </div>
            {isStatic ? (
              <div className="sm:col-span-3 rounded-lg border border-primary/40 bg-primary/5 p-3">
                <p className="mb-1 font-semibold text-foreground">
                  Static mode — frozen at t = {STATIC_FRAME_T.toFixed(2)}s
                </p>
                <p className="mb-2">
                  Nothing is animating: every band and node below is sampled at that single
                  timestamp, so the still frame is reproducible and safe to screenshot. Bands are
                  listed low to high; the marked rows are the partials carrying the frame and the
                  ontology nodes drawn largest and brightest in it.
                </p>
                <ul className="grid gap-1 sm:grid-cols-2">
                  {staticBands.map((b) => (
                    <li key={b.category} className="flex items-center gap-2">
                      <span
                        aria-hidden
                        className="h-2 w-2 shrink-0 rounded-full"
                        style={{ background: categoryToken(b.category) }}
                      />
                      <span className="text-foreground">
                        Band {b.band} · {CATEGORY_LABELS[b.category] ?? b.category}
                      </span>
                      <span>{b.score}/100</span>
                      {b.dominant ? (
                        <span className="rounded border border-primary/50 px-1 text-[10px] text-primary">
                          node lit
                        </span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            <div>
              <p className="mb-1 font-semibold text-foreground">Ontology node highlights</p>
              <p>
                In <strong>Node pulse</strong> mode, each dot is one ontology category node, colored
                with the same token as the chips above and sized by its score; it pulses in time with
                its own band, so dominant categories flare hardest. Selecting an analysis here also
                pulses that source&apos;s nodes in the Network tab. In compare mode, the red band
                between two traces is the divergence the similarity score measures.
              </p>
            </div>
          </div>
        ) : null}
      </div>

      {subject.audioUrl ? (
        <audio ref={audioRef} src={subject.audioUrl} crossOrigin="anonymous" loop preload="none" className="hidden" />
      ) : null}
    </Card>
  );
};

export default SonicSimPanel;
