/**
 * Meaning lens driver.
 *
 * Every `scope.window_seconds` (read from the Control Room registry, Step 9)
 * the accumulated Meyda window summary is sent to `scope-window-score` and the
 * returned taxonomy tags "light up". Hard rules:
 *   * never more than one call per window (client throttle + server throttle);
 *   * a call in flight blocks the next one;
 *   * failures degrade silently to the last known tag set.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { ScopeFeatures } from "@/lib/audioscope/features";
import { appendTrailEntry, type TrailEntry } from "@/lib/audioscope/trail";
import type { CategoryScores } from "@/lib/audioscope";

export interface ScopeTag {
  id: string;
  code: string;
  label: string;
  similarity: number;
}

export interface ScopeDebug {
  knn_k: number;
  prior_blend_weight: number;
  bridge_active_id: string | null;
  neighbors: ScopeTag[];
  axes_in: Record<string, number>;
  features: { rms: number; centroidHz: number; chroma: number[] };
}

export interface TagMarker {
  /** Seconds on the scope timeline when the tag fired. */
  t: number;
  code: string;
  label: string;
  similarity: number;
}

export const DEFAULT_WINDOW_SECONDS = 5;

/** Client-safe read of the scope knobs (admin-only rows stay unreadable). */
export function useScopeWindowSeconds(): number {
  const [seconds, setSeconds] = useState(DEFAULT_WINDOW_SECONDS);
  useEffect(() => {
    let alive = true;
    void (async () => {
      const { data, error } = await supabase.rpc("client_control", {
        _key: "scope.window_seconds",
      });
      if (!alive || error) return;
      const n = Number(data);
      if (Number.isFinite(n) && n >= 1 && n <= 60) setSeconds(n);
    })();
    return () => {
      alive = false;
    };
  }, []);
  return seconds;
}

interface Options {
  /** Pauses scoring when false (paused scope, static frame, off-screen). */
  enabled: boolean;
  windowSeconds: number;
  subjectRef?: string;
}

export function useScopeWindowScore({ enabled, windowSeconds, subjectRef }: Options) {
  const [tags, setTags] = useState<ScopeTag[]>([]);
  const [markers, setMarkers] = useState<TagMarker[]>([]);
  const [trail, setTrail] = useState<TrailEntry[]>([]);
  const [debug, setDebug] = useState<ScopeDebug | null>(null);
  const [status, setStatus] = useState<"idle" | "scoring" | "error" | "unconfigured">("idle");
  const inFlight = useRef(false);
  const lastAt = useRef(0);

  /**
   * Call at most once per window; extra calls are dropped, not queued.
   * `mediaSeconds` is the seekable media position (falls back to the scope
   * timeline for silhouettes) and is what the trail keys on.
   */
  const score = useCallback(
    async (
      features: ScopeFeatures,
      axes: CategoryScores,
      timelineSeconds: number,
      mediaSeconds?: number,
    ) => {
      if (!enabled || inFlight.current) return;
      const now = Date.now();
      if (now - lastAt.current < windowSeconds * 1000) return;
      lastAt.current = now;
      inFlight.current = true;
      setStatus("scoring");
      try {
        const { data, error } = await supabase.functions.invoke("scope-window-score", {
          body: {
            features: {
              rms: features.rms,
              centroidHz: features.centroidHz,
              chroma: features.chroma,
            },
            axes,
            subject_ref: subjectRef ?? "scope",
          },
        });
        if (error) throw error;
        const payload = data as {
          success?: boolean;
          throttled?: boolean;
          configured?: boolean;
          tags?: ScopeTag[];
          axes?: CategoryScores;
          debug?: ScopeDebug;
        };
        if (payload?.configured === false) {
          setStatus("unconfigured");
          return;
        }
        if (payload?.throttled) {
          setStatus("idle");
          return;
        }
        const next = (payload?.tags ?? []).filter((t) => t && t.code);
        if (next.length) {
          setTags(next);
          const top = next[0];
          setMarkers((prev) =>
            [...prev, { t: timelineSeconds, code: top.code, label: top.label, similarity: top.similarity }]
              // Keep the trail bounded; the strip only shows recent history.
              .slice(-40),
          );
          setTrail((prev) =>
            appendTrailEntry(prev, {
              t: Number.isFinite(mediaSeconds as number) ? (mediaSeconds as number) : timelineSeconds,
              scopeT: timelineSeconds,
              tags: next.map((t) => ({ code: t.code, label: t.label, similarity: t.similarity })),
              axes: payload?.axes ?? axes,
              features: { rms: features.rms, centroidHz: features.centroidHz },
            }),
          );
        }
        setDebug(payload?.debug ?? null);
        setStatus("idle");
      } catch {
        setStatus("error");
      } finally {
        inFlight.current = false;
      }
    },
    [enabled, windowSeconds, subjectRef],
  );

  const reset = useCallback(() => {
    setTags([]);
    setMarkers([]);
    setTrail([]);
    setDebug(null);
    lastAt.current = 0;
  }, []);

  return { tags, markers, trail, debug, status, score, reset };
}

