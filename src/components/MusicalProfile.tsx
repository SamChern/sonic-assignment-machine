// Musical read — pitch, rhythm and timbre for music-driven audio.
//
// The six SemanticAC categories say how audio relates to humans; they say
// nothing about musical craft. These three bars fill that gap, derived from the
// librosa measurements and how music-like CLAP found the audio. When
// `musicality` is low (a voiceover, a CTV spoken-word signal) the block reports
// that instead of pretending a monologue has a key.
import { Badge } from "@/components/ui/badge";
import { Music4 } from "lucide-react";

export interface MusicalRead {
  name?: string;
  pitch: number;
  rhythm: number;
  timbre: number;
  musicality: number;
  notes?: {
    key?: string | null;
    mode?: string | null;
    tempo_bpm?: number | null;
    tonal_clarity?: number;
    beat_regularity?: number;
    brightness?: number;
    speech_like?: number;
  } | null;
}

const BARS = [
  { key: "pitch", label: "Pitch", hint: "stability of a tonal centre" },
  { key: "rhythm", label: "Rhythm", hint: "steadiness and articulation of the pulse" },
  { key: "timbre", label: "Timbre", hint: "spectral richness and sculpting" },
] as const;

/** Musicality under this reads as spoken word rather than music. */
const SPEECH_FLOOR = 0.35;

export const MusicalProfile = ({ read, compact = false }: { read: MusicalRead; compact?: boolean }) => {
  const speechLike = read.musicality < SPEECH_FLOOR;
  const notes = read.notes ?? {};

  return (
    <div className="w-full space-y-2 rounded-xl border border-border/60 bg-muted/10 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Music4 className="h-3.5 w-3.5 text-primary" />
        <h4 className="text-xs font-semibold">Musical read</h4>
        <Badge variant="outline" className="px-1.5 py-0 text-[9px]">
          musicality {(read.musicality * 100).toFixed(0)}%
        </Badge>
        {speechLike && (
          <Badge variant="secondary" className="px-1.5 py-0 text-[9px]">
            spoken-word leaning
          </Badge>
        )}
      </div>

      <div className="space-y-1.5">
        {BARS.map((b) => {
          const v = Math.max(0, Math.min(100, Number(read[b.key] ?? 0)));
          return (
            <div key={b.key} className="space-y-0.5" title={b.hint}>
              <div className="flex items-center justify-between text-[10px]">
                <span className="font-medium">{b.label}</span>
                <span className="tabular-nums text-muted-foreground">{v.toFixed(0)}</span>
              </div>
              <div
                className={`h-1.5 overflow-hidden rounded-full bg-muted/40 ${
                  speechLike ? "opacity-50" : ""
                }`}
              >
                <div
                  className="h-full rounded-full bg-primary transition-[width] duration-500"
                  style={{ width: `${v}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>

      {!compact && (
        <p className="text-[10px] leading-relaxed text-muted-foreground">
          {speechLike
            ? "Mostly speech — the musical scores are reported but carry little weight for this source."
            : [
                notes.key ? `Key ${notes.key}${notes.mode ? ` ${notes.mode}` : ""}` : null,
                notes.tempo_bpm ? `${Math.round(notes.tempo_bpm)} BPM` : null,
                notes.beat_regularity !== undefined
                  ? `beat regularity ${(Number(notes.beat_regularity) * 100).toFixed(0)}%`
                  : null,
              ]
                .filter(Boolean)
                .join(" · ") || "Derived from measured audio."}
        </p>
      )}
    </div>
  );
};

export default MusicalProfile;
