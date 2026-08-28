/**
 * Shared signal provider so the three lenses of the Semantic Scope (time,
 * frequency, meaning) read the *same* sound rather than three independent
 * AudioContexts. The waveform rendering itself is untouched — Audioscope just
 * accepts the provider instead of building its own.
 */
import { useEffect, useState } from "react";
import { createLiveAudioSignal } from "./liveAudio";
import { createSyntheticSignal } from "./synthetic";
import { createSilhouetteSignal, type SilhouetteTag } from "./silhouette";
import type { AudioscopeFeatureHints, AudioscopeSignal, CategoryScores } from "./types";

export interface UseSignalOptions {
  scores: CategoryScores;
  seed?: string;
  features?: AudioscopeFeatureHints | null;
  /** When playable, real audio drives every lens. */
  mediaEl?: HTMLMediaElement | null;
  /** Tag mix for the zero-audio silhouette (Intuizi subjects). */
  tags?: SilhouetteTag[] | null;
}

export function useAudioscopeSignal({
  scores,
  seed = "sonicsim",
  features = null,
  mediaEl = null,
  tags = null,
}: UseSignalOptions): AudioscopeSignal | null {
  const [signal, setSignal] = useState<AudioscopeSignal | null>(null);
  const tagKey = (tags ?? []).map((t) => `${t.code}:${Number(t.weight).toFixed(3)}`).join(",");

  useEffect(() => {
    let next: AudioscopeSignal | null = null;
    if (mediaEl) {
      try {
        next = createLiveAudioSignal(mediaEl);
      } catch {
        next = null;
      }
    }
    if (!next) {
      next = tags && tags.length
        ? createSilhouetteSignal({ scores, tags, seed })
        : createSyntheticSignal({ scores, seed, features });
    }
    setSignal(next);
    return () => {
      next?.dispose();
      setSignal(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mediaEl, seed, tagKey, JSON.stringify(scores), JSON.stringify(features)]);

  return signal;
}
