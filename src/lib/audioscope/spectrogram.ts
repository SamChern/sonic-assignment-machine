/**
 * Frequency lens — a scrolling spectrogram strip fed by the same signal
 * provider (and therefore the same AnalyserNode) as the waveform, with thin
 * Meyda feature traces (energy = RMS, brightness = spectral centroid) drawn
 * over it. Pure canvas, no dependency.
 *
 * Scrolling is done by blitting the canvas one column to the left and painting
 * only the newest column, so cost per frame is O(bins) regardless of width.
 */
import { clamp01, type CategoryScores } from "./types";

export interface SpectrogramColors {
  bg: string;
  grid: string;
  /** Six category colors, low band -> high band. */
  cats: string[];
  energy: string;
  brightness: string;
}

export interface SpectrogramColumn {
  /** Normalized magnitudes 0..1, low frequency first. */
  spectrum: Float32Array;
  /** 0..1 RMS for the energy trace. */
  energy: number;
  /** 0..1 brightness for the centroid trace. */
  brightness: number;
  /** Optional marker: a tag fired on this column. */
  marker?: boolean;
}

/** Column width in CSS pixels — 2px keeps a minute of history readable. */
const COL_W = 2;

export class ScrollingSpectrogram {
  private ctx: CanvasRenderingContext2D;
  private w = 0;
  private h = 0;

  constructor(
    private canvas: HTMLCanvasElement,
    private colors: SpectrogramColors,
  ) {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("2d context unavailable");
    this.ctx = ctx;
    this.resize();
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.w = this.canvas.clientWidth || 600;
    this.h = this.canvas.clientHeight || 72;
    this.canvas.width = Math.floor(this.w * dpr);
    this.canvas.height = Math.floor(this.h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.ctx.fillStyle = this.colors.bg;
    this.ctx.fillRect(0, 0, this.w, this.h);
  }

  clear() {
    this.ctx.fillStyle = this.colors.bg;
    this.ctx.fillRect(0, 0, this.w, this.h);
  }

  /** Push one column of history and scroll everything left. */
  push(col: SpectrogramColumn) {
    const { ctx, w, h } = this;
    // Blit left by COL_W.
    ctx.save();
    ctx.globalCompositeOperation = "copy";
    // Source is the canvas itself (device px); the transform maps it back to
    // CSS px, so a -COL_W offset shifts history exactly one column left.
    ctx.drawImage(this.canvas, -COL_W, 0, w, h);
    ctx.restore();

    const x = w - COL_W;
    ctx.fillStyle = this.colors.bg;
    ctx.fillRect(x, 0, COL_W, h);

    const bins = col.spectrum.length || 1;
    const cats = this.colors.cats.length || 1;
    for (let i = 0; i < bins; i++) {
      const mag = clamp01(col.spectrum[i]);
      if (mag <= 0.02) continue;
      // Low frequency at the bottom, like a studio spectrogram.
      const y = h - ((i + 1) / bins) * h;
      const cell = h / bins;
      ctx.globalAlpha = 0.12 + mag * 0.88;
      ctx.fillStyle = this.colors.cats[Math.min(cats - 1, Math.floor((i / bins) * cats))];
      ctx.fillRect(x, y, COL_W, Math.max(1, cell));
    }
    ctx.globalAlpha = 1;

    // Feature ribbons: energy from the bottom, brightness as a bright dot.
    const ey = h - clamp01(col.energy) * h;
    ctx.fillStyle = this.colors.energy;
    ctx.globalAlpha = 0.9;
    ctx.fillRect(x, ey, COL_W, 1.5);

    const by = h - clamp01(col.brightness) * h;
    ctx.fillStyle = this.colors.brightness;
    ctx.fillRect(x, by, COL_W, 1.5);
    ctx.globalAlpha = 1;

    if (col.marker) {
      ctx.strokeStyle = this.colors.brightness;
      ctx.globalAlpha = 0.85;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x + COL_W / 2, 0);
      ctx.lineTo(x + COL_W / 2, h);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }
}

/** Band -> category mapping used by the strip legend. */
export function bandLabel(index: number, categories: readonly string[]): string {
  return categories[Math.min(categories.length - 1, index)] ?? "";
}

/** Six-axis vector estimated from a spectrum column — used by the meaning lens
 * as an instant readout between scoring windows. */
export function spectrumToAxes(
  spectrum: Float32Array,
  categories: readonly string[],
): CategoryScores {
  const out = {} as CategoryScores;
  const per = Math.max(1, Math.floor(spectrum.length / categories.length));
  categories.forEach((c, i) => {
    let sum = 0;
    let n = 0;
    for (let k = i * per; k < (i + 1) * per && k < spectrum.length; k++) {
      sum += spectrum[k];
      n++;
    }
    (out as Record<string, number>)[c] = Math.round(clamp01(n ? sum / n : 0) * 100);
  });
  return out;
}
