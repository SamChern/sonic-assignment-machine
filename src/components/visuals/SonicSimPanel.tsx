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
import { Activity, Maximize2, Minimize2, Pause, Play, RotateCcw, Radar, Network } from "lucide-react";
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

export const SonicSimPanel = ({
  subjects,
  title = "See my SonicSIM",
  description = "Play your sonic fingerprint, or any single semantic analysis, as a live audioscope.",
  defaultMode = "radial",
  height = 340,
}: SonicSimPanelProps) => {
  const [subjectId, setSubjectId] = useState<string>(subjects[0]?.id ?? "");
  const [mode, setMode] = useState<AudioscopeMode>(defaultMode);
  const [playing, setPlaying] = useState(true);
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

  useEffect(() => {
    // Switching subject drops any previous real-audio routing.
    setLiveEl(null);
    audioRef.current?.pause();
  }, [subjectId]);

  useEffect(() => {
    const onChange = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const togglePlay = async () => {
    const next = !playing;
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
          {subject.audioUrl
            ? liveEl
              ? "Real audio signal"
              : "Press play for real audio"
            : "Synthesized from fingerprint"}
        </Badge>
      </div>

      <div ref={wrapRef} className="bg-background/40 px-4 pb-4">
        <Audioscope
          key={`${subject.id}-${mode}-${replayKey}`}
          scores={subject.scores}
          seed={subject.id}
          features={subject.features ?? null}
          mode={mode}
          playing={playing}
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
      </div>

      {subject.audioUrl ? (
        <audio ref={audioRef} src={subject.audioUrl} crossOrigin="anonymous" loop preload="none" className="hidden" />
      ) : null}
    </Card>
  );
};

export default SonicSimPanel;
