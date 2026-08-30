/**
 * Step 15 — Sonic Signature + Ensemble archetype.
 *
 * Renders (or reuses) the 3.5s signature for a six-axis vector, plays it, and
 * names the archetype it lands nearest to. Falls back to local WebAudio
 * synthesis if the server clip can't be fetched.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Pause, Play, Sparkles } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import type { SignatureVector } from "@/lib/signature/mapping";
import { playFallback, playUrl, type SignaturePlayback } from "@/lib/signature/player";

interface Archetype {
  slug: string;
  name: string;
  meaning: string;
  dominant_axes: string[];
  anchors: string[];
}

interface SignatureCardProps {
  vector: SignatureVector;
  tags?: string[];
  subjectRef?: string;
  className?: string;
  /** Compact variant drops the anchors line. */
  compact?: boolean;
}

export const SignatureCard = ({
  vector,
  tags = [],
  subjectRef,
  className,
  compact = false,
}: SignatureCardProps) => {
  const [loading, setLoading] = useState(false);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [archetype, setArchetype] = useState<Archetype | null>(null);
  const [distance, setDistance] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [level, setLevel] = useState(0);

  const playbackRef = useRef<SignaturePlayback | null>(null);
  const rafRef = useRef<number | null>(null);

  // Stable key so we only re-render the signature when the vector really changes.
  const vectorKey = useMemo(
    () => JSON.stringify(vector) + "|" + tags.join(","),
    [vector, tags],
  );

  const stop = useCallback(() => {
    playbackRef.current?.stop();
    playbackRef.current = null;
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    setPlaying(false);
    setLevel(0);
  }, []);

  useEffect(() => stop, [stop, vectorKey]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);

    (async () => {
      try {
        // Bounded so a stalled render never leaves Play disabled forever.
        const { data, error: fnError } = await invokeWithTimeout<{
          success?: boolean;
          error?: string;
          signature?: { audio_url?: string; distance?: number; archetype_slug?: string };
        }>("signature-render", {
          body: { vector, tags, subject_ref: subjectRef },
          timeoutMs: 45_000,
        });
        if (!active) return;
        if (fnError) throw fnError;
        if (!data?.success) throw new Error(data?.error ?? "Could not render signature");

        setAudioUrl(data.signature?.audio_url ?? null);
        setDistance(
          typeof data.signature?.distance === "number" ? data.signature.distance : null,
        );

        const slug = data.signature?.archetype_slug;
        if (slug) {
          const { data: arch } = await supabase
            .from("sonic_archetypes")
            .select("slug, name, meaning, dominant_axes, anchors")
            .eq("slug", slug)
            .maybeSingle();
          if (active && arch) setArchetype(arch as Archetype);
        }
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : "Signature unavailable");
      } finally {
        if (active) setLoading(false);
      }
    })();

    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vectorKey]);

  const trackLevel = useCallback(() => {
    const playback = playbackRef.current;
    if (!playback) return;
    setLevel(playback.getLevel());
    rafRef.current = requestAnimationFrame(trackLevel);
  }, []);

  const togglePlay = useCallback(async () => {
    if (playing) {
      stop();
      return;
    }
    try {
      const playback = audioUrl
        ? await playUrl(audioUrl).catch(() => playFallback(vector, tags))
        : await playFallback(vector, tags);
      playbackRef.current = playback;
      setPlaying(true);
      rafRef.current = requestAnimationFrame(trackLevel);
      window.setTimeout(() => {
        if (playbackRef.current === playback) stop();
      }, playback.duration * 1000 + 120);
    } catch {
      setError("Playback blocked by the browser — tap again to allow audio.");
    }
  }, [audioUrl, playing, stop, tags, trackLevel, vector]);

  return (
    <Card
      className={cn(
        "relative overflow-hidden border-primary/20 p-4 shadow-elegant",
        className,
      )}
    >
      {/* Level bloom behind the content while playing */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-gradient-to-tr from-primary/20 via-transparent to-transparent transition-opacity duration-150"
        style={{ opacity: playing ? 0.35 + level * 0.65 : 0 }}
      />

      <div className="relative flex items-start gap-4">
        <Button
          type="button"
          size="icon"
          variant="secondary"
          className="h-12 w-12 shrink-0 rounded-full border border-primary/30"
          onClick={togglePlay}
          disabled={loading}
          aria-label={playing ? "Stop sonic signature" : "Play sonic signature"}
          style={{
            transform: playing ? `scale(${1 + level * 0.08})` : undefined,
            transition: "transform 100ms linear",
          }}
        >
          {loading ? (
            <Loader2 className="h-5 w-5 animate-spin" />
          ) : playing ? (
            <Pause className="h-5 w-5" />
          ) : (
            <Play className="h-5 w-5" />
          )}
        </Button>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Sparkles className="h-3.5 w-3.5 text-primary" />
            <span className="text-xs font-medium uppercase tracking-wide text-primary/80">
              Sonic Signature
            </span>
            {distance !== null && (
              <Badge variant="outline" className="text-[10px] tabular-nums">
                fit {Math.max(0, Math.round((1 - distance / 100) * 100))}%
              </Badge>
            )}
          </div>

          {archetype ? (
            <>
              <h4 className="mt-1 truncate text-base font-bold text-foreground">
                {archetype.name}
              </h4>
              <p className="text-sm text-muted-foreground">{archetype.meaning}</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {archetype.dominant_axes?.map((axis) => (
                  <Badge key={axis} variant="secondary" className="text-[10px] capitalize">
                    {axis}
                  </Badge>
                ))}
              </div>
              {archetype.anchors?.length > 0 && (
                // The anchors are the whole point of the Ensemble — they say what
                // this signal sounds *like*. Compact only shortens the list.
                <p className="mt-2 text-xs leading-relaxed text-muted-foreground/80">
                  <span className="text-muted-foreground">In the lineage of </span>
                  {(compact ? archetype.anchors.slice(0, 3) : archetype.anchors).join(" · ")}
                  {compact && archetype.anchors.length > 3 && (
                    <span className="text-muted-foreground/60">
                      {" "}+{archetype.anchors.length - 3} more
                    </span>
                  )}
                </p>
              )}

            </>
          ) : (
            <p className="mt-1 text-sm text-muted-foreground">
              {error ?? (loading ? "Rendering signature…" : "No archetype assigned yet.")}
            </p>
          )}

          {error && archetype && (
            <p role="status" className="mt-2 text-xs text-destructive">
              {error}
            </p>
          )}
        </div>
      </div>
    </Card>
  );
};
