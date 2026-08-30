/**
 * Signature playback: prefers the server-rendered clip, falls back to
 * synthesising the exact same phrase locally through WebAudio.
 */
import {
  SIGNATURE_DURATION,
  SIGNATURE_SAMPLE_RATE,
  renderSignature,
  subjectHash,
  vectorToParams,
  type SignatureVector,
} from "./mapping";

let ctx: AudioContext | null = null;

function audioContext(): AudioContext {
  if (!ctx) {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    ctx = new Ctor();
  }
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

export interface SignaturePlayback {
  stop: () => void;
  /** Live 0..1 level, sampled for the Scope visual. */
  getLevel: () => number;
  duration: number;
}

/** Play a rendered clip from a URL. */
export async function playUrl(url: string): Promise<SignaturePlayback> {
  const context = audioContext();
  const bytes = await fetch(url).then((r) => r.arrayBuffer());
  const buffer = await context.decodeAudioData(bytes);
  return startBuffer(context, buffer);
}

/** Synthesize and play locally — used when the server clip is unavailable. */
export async function playFallback(
  vector: SignatureVector,
  tags: string[] = [],
): Promise<SignaturePlayback> {
  const context = audioContext();
  const hash = await subjectHash(vector, tags);
  const params = vectorToParams(vector, tags);
  const samples = renderSignature(params, hash, SIGNATURE_SAMPLE_RATE, SIGNATURE_DURATION);

  const buffer = context.createBuffer(1, samples.length, SIGNATURE_SAMPLE_RATE);
  buffer.copyToChannel(samples as Float32Array<ArrayBuffer>, 0);
  return startBuffer(context, buffer);
}

function startBuffer(context: AudioContext, buffer: AudioBuffer): SignaturePlayback {
  const source = context.createBufferSource();
  source.buffer = buffer;

  const analyser = context.createAnalyser();
  analyser.fftSize = 512;
  const bins = new Uint8Array(analyser.frequencyBinCount);

  source.connect(analyser);
  analyser.connect(context.destination);
  source.start();

  let stopped = false;
  source.onended = () => {
    stopped = true;
  };

  return {
    duration: buffer.duration,
    stop: () => {
      if (stopped) return;
      stopped = true;
      try {
        source.stop();
      } catch {
        // already ended
      }
    },
    getLevel: () => {
      if (stopped) return 0;
      analyser.getByteFrequencyData(bins);
      let sum = 0;
      for (let i = 0; i < bins.length; i++) sum += bins[i];
      return Math.min(1, sum / bins.length / 140);
    },
  };
}
