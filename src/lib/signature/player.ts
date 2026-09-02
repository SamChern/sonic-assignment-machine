/**
 * Signature playback.
 *
 * Both paths (server-rendered clip and the local synth fallback) play through a
 * real HTMLAudioElement rather than a raw WebAudio graph. WebAudio-only output
 * was the reason "Play" looked active but stayed silent on phones: iOS routes
 * bare AudioContext output through the ringer channel (muted by the silent
 * switch) and Chrome keeps the context suspended until `resume()` resolves.
 * A media element uses the media channel, honours the hardware volume, and
 * surfaces real errors we can report.
 *
 * The 0..1 level used for the card's bloom is derived from playback position,
 * so the visual no longer depends on an analyser node.
 */
import {
  SIGNATURE_DURATION,
  SIGNATURE_SAMPLE_RATE,
  encodeWav,
  renderSignature,
  subjectHash,
  vectorToParams,
  type SignatureVector,
} from "./mapping";

export interface SignaturePlayback {
  stop: () => void;
  /** Live 0..1 level, sampled for the Scope visual. */
  getLevel: () => number;
  duration: number;
}

/** Play a rendered clip from a URL. */
export async function playUrl(url: string): Promise<SignaturePlayback> {
  return startElement(url, SIGNATURE_DURATION);
}

/** Synthesize and play locally — used when the server clip is unavailable. */
export async function playFallback(
  vector: SignatureVector,
  tags: string[] = [],
): Promise<SignaturePlayback> {
  const hash = await subjectHash(vector, tags);
  const params = vectorToParams(vector, tags);
  const samples = renderSignature(params, hash, SIGNATURE_SAMPLE_RATE, SIGNATURE_DURATION);
  const wav = encodeWav(samples, SIGNATURE_SAMPLE_RATE);
  const blob = new Blob([wav as unknown as BlobPart], { type: "audio/wav" });
  const url = URL.createObjectURL(blob);
  try {
    return await startElement(url, SIGNATURE_DURATION, () => URL.revokeObjectURL(url));
  } catch (err) {
    URL.revokeObjectURL(url);
    throw err;
  }
}

async function startElement(
  src: string,
  fallbackDuration: number,
  cleanup?: () => void,
): Promise<SignaturePlayback> {
  const el = document.createElement("audio");
  el.src = src;
  el.preload = "auto";
  el.volume = 1;
  // Keep it out of layout but attached, so mobile Safari treats it as a real
  // media element rather than a detached node it may garbage-collect.
  el.setAttribute("playsinline", "");
  el.style.display = "none";
  document.body.appendChild(el);

  let stopped = false;
  const teardown = () => {
    if (stopped) return;
    stopped = true;
    try {
      el.pause();
    } catch {
      /* already gone */
    }
    el.remove();
    cleanup?.();
  };
  el.addEventListener("ended", teardown);

  try {
    await el.play();
  } catch (err) {
    teardown();
    throw err;
  }

  return {
    duration: Number.isFinite(el.duration) && el.duration > 0 ? el.duration : fallbackDuration,
    stop: teardown,
    getLevel: () => {
      if (stopped || el.paused) return 0;
      const t = el.currentTime;
      // Smooth, content-agnostic pulse: two detuned envelopes so the bloom breathes
      // with the phrase without needing an analyser tap on the output.
      const pulse = 0.5 + 0.5 * Math.sin(t * 7.4) * Math.sin(t * 2.1 + 0.6);
      return Math.max(0, Math.min(1, pulse * 0.8));
    },
  };
}
