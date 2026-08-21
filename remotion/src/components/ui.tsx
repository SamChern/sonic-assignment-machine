import React from "react";
import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { C, CATS, body, display } from "../theme";

/** Default entrance: rise + blur-to-sharp on a smooth spring. */
export function useRise(delay = 0, distance = 30) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({
    frame: frame - delay,
    fps,
    config: { damping: 200 },
    durationInFrames: 28,
  });
  return {
    opacity: s,
    transform: `translateY(${interpolate(s, [0, 1], [distance, 0])}px)`,
    filter: `blur(${interpolate(s, [0, 1], [12, 0])}px)`,
  } as React.CSSProperties;
}

export const Rise: React.FC<{
  delay?: number;
  distance?: number;
  style?: React.CSSProperties;
  children: React.ReactNode;
}> = ({ delay = 0, distance = 30, style, children }) => {
  const r = useRise(delay, distance);
  return <div style={{ ...r, ...style }}>{children}</div>;
};

/** Slow breathing drift so nothing is ever perfectly static. */
export function useDrift(amp = 8, speed = 0.018, phase = 0) {
  const frame = useCurrentFrame();
  return Math.sin(frame * speed + phase) * amp;
}

/** Deterministic pseudo-noise, seeded — renders identically every frame. */
export function noise(i: number, seed = 1) {
  return (Math.sin(i * 12.9898 * seed) * 43758.5453) % 1;
}

export const Scene: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const drift = useDrift(16, 0.011);
  return (
    <AbsoluteFill
      style={{
        backgroundColor: C.ink,
        fontFamily: body,
        color: C.fg,
        overflow: "hidden",
      }}
    >
      <AbsoluteFill
        style={{
          background: `radial-gradient(1200px 820px at ${16 + drift}% ${18 - drift * 0.35}%, rgba(94,207,192,0.16), transparent 62%),
                       radial-gradient(1000px 800px at 94% 92%, rgba(44,127,118,0.22), transparent 62%)`,
        }}
      />
      <AbsoluteFill
        style={{
          backgroundImage:
            "linear-gradient(rgba(255,255,255,0.026) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.026) 1px, transparent 1px)",
          backgroundSize: "80px 80px",
          maskImage:
            "radial-gradient(1500px 900px at 50% 45%, black, transparent 78%)",
        }}
      />
      {children}
    </AbsoluteFill>
  );
};

/** Kicker + headline + one supporting line. Edge aligned, never centred. */
export const Super: React.FC<{
  kicker: string;
  title: string;
  line?: string;
  delay?: number;
  width?: number;
}> = ({ kicker, title, line, delay = 0, width = 720 }) => (
  <div style={{ maxWidth: width }}>
    <Rise delay={delay} distance={16}>
      <div
        style={{
          fontWeight: 700,
          letterSpacing: 4,
          textTransform: "uppercase",
          fontSize: 18,
          color: C.teal,
        }}
      >
        {kicker}
      </div>
    </Rise>
    <Rise delay={delay + 5}>
      <div
        style={{
          fontFamily: display,
          fontWeight: 700,
          fontSize: 74,
          lineHeight: 1.02,
          marginTop: 18,
          letterSpacing: -2.4,
          whiteSpace: "pre-line",
        }}
      >
        {title}
      </div>
    </Rise>
    {line && (
      <Rise delay={delay + 13}>
        <div
          style={{
            marginTop: 22,
            fontSize: 27,
            lineHeight: 1.45,
            color: C.muted,
            maxWidth: width - 60,
          }}
        >
          {line}
        </div>
      </Rise>
    )}
  </div>
);

/** Glass panel used for every product mock. */
export const Panel: React.FC<{
  children: React.ReactNode;
  delay?: number;
  width?: number;
  height?: number;
  label?: string;
  style?: React.CSSProperties;
}> = ({ children, delay = 0, width = 800, height = 560, label, style }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({
    frame: frame - delay,
    fps,
    config: { damping: 26, stiffness: 110 },
    durationInFrames: 42,
  });
  const drift = useDrift(6, 0.016, 1.2);
  return (
    <div
      style={{
        width,
        height,
        borderRadius: 22,
        border: `1px solid ${C.line}`,
        background: `linear-gradient(160deg, ${C.panel}, ${C.ink2})`,
        boxShadow: "0 60px 110px -50px rgba(0,0,0,0.9)",
        overflow: "hidden",
        opacity: s,
        transform: `translateY(${interpolate(s, [0, 1], [52, drift])}px) scale(${interpolate(
          s,
          [0, 1],
          [0.96, 1],
        )})`,
        ...style,
      }}
    >
      <div
        style={{
          height: 46,
          display: "flex",
          alignItems: "center",
          gap: 9,
          padding: "0 18px",
          borderBottom: `1px solid ${C.line}`,
          background: "rgba(255,255,255,0.02)",
        }}
      >
        {[C.teal, C.deep, C.line].map((c) => (
          <div
            key={c}
            style={{ width: 10, height: 10, borderRadius: 10, background: c }}
          />
        ))}
        <div style={{ marginLeft: 12, fontSize: 16, color: C.muted }}>
          {label ?? "SonicSIM"}
        </div>
      </div>
      <div
        style={{ padding: 22, height: height - 46, boxSizing: "border-box" }}
      >
        {children}
      </div>
    </div>
  );
};

export const Pill: React.FC<{
  children: React.ReactNode;
  color?: string;
  delay?: number;
  solid?: boolean;
}> = ({ children, color = C.teal, delay = 0, solid = false }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({
    frame: frame - delay,
    fps,
    config: { damping: 14, stiffness: 180 },
  });
  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 9,
        padding: "9px 16px",
        borderRadius: 999,
        border: `1px solid ${solid ? color : "rgba(255,255,255,0.12)"}`,
        background: solid ? color : "rgba(255,255,255,0.04)",
        color: solid ? "#04100E" : C.fg,
        fontSize: 18,
        fontWeight: 700,
        opacity: s,
        transform: `scale(${interpolate(s, [0, 1], [0.82, 1])})`,
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </div>
  );
};

/** Live waveform — the app's signature motif. */
export const Waveform: React.FC<{
  width: number;
  height: number;
  bars?: number;
  color?: string;
  opacity?: number;
  speed?: number;
  seed?: number;
}> = ({
  width,
  height,
  bars = 72,
  color = C.teal,
  opacity = 0.55,
  speed = 0.09,
  seed = 1,
}) => {
  const frame = useCurrentFrame();
  const w = width / bars;
  return (
    <svg width={width} height={height} style={{ opacity, display: "block" }}>
      {Array.from({ length: bars }, (_, i) => {
        const base =
          Math.sin(i * 0.36 + frame * speed) * 0.5 +
          Math.cos(i * 0.13 - frame * speed * 0.6) * 0.3 +
          Math.abs(noise(i + 1, seed)) * 0.35;
        const h = Math.max(4, (0.35 + base * 0.5) * height);
        return (
          <rect
            key={i}
            x={i * w}
            y={(height - h) / 2}
            width={Math.max(2, w * 0.52)}
            height={h}
            rx={Math.max(1, w * 0.26)}
            fill={color}
          />
        );
      })}
    </svg>
  );
};

/** Six-axis ontological fingerprint. */
export const Radar: React.FC<{
  values: number[];
  size?: number;
  delay?: number;
  labels?: boolean;
  stroke?: string;
}> = ({ values, size = 420, delay = 0, labels = true, stroke = C.teal }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const grow = spring({
    frame: frame - delay,
    fps,
    config: { damping: 200 },
    durationInFrames: 40,
  });
  const cx = size / 2;
  const cy = size / 2;
  const R = size / 2 - (labels ? 56 : 14);
  const pts = values.map((v, i) => {
    const a = (Math.PI * 2 * i) / 6 - Math.PI / 2;
    const r = (Math.min(100, v) / 100) * R * grow;
    return {
      x: cx + r * Math.cos(a),
      y: cy + r * Math.sin(a),
      lx: cx + (R + 34) * Math.cos(a),
      ly: cy + (R + 34) * Math.sin(a),
      a,
      v,
    };
  });
  const path = pts.map((p, i) => `${i ? "L" : "M"} ${p.x} ${p.y}`).join(" ") + " Z";

  return (
    <svg width={size} height={size} style={{ overflow: "visible" }}>
      {[25, 50, 75, 100].map((p) => (
        <circle
          key={p}
          cx={cx}
          cy={cy}
          r={(p / 100) * R}
          fill="none"
          stroke={C.line}
          strokeWidth={p === 100 ? 1.4 : 0.8}
          strokeDasharray={p === 100 ? undefined : "5 6"}
        />
      ))}
      {pts.map((p, i) => (
        <line
          key={`ax${i}`}
          x1={cx}
          y1={cy}
          x2={cx + R * Math.cos(p.a)}
          y2={cy + R * Math.sin(p.a)}
          stroke={C.line}
          strokeWidth={0.8}
        />
      ))}
      <path
        d={path}
        fill="rgba(94,207,192,0.16)"
        stroke={stroke}
        strokeWidth={2.4}
      />
      {pts.map((p, i) => (
        <g key={`pt${i}`}>
          <circle
            cx={p.x}
            cy={p.y}
            r={6}
            fill={CATS[i]!.color}
            stroke={C.ink}
            strokeWidth={2}
          />
          {labels && (
            <text
              x={p.lx}
              y={p.ly}
              textAnchor="middle"
              dominantBaseline="middle"
              fill={C.muted}
              style={{ fontFamily: body, fontSize: 17, fontWeight: 500 }}
            >
              {CATS[i]!.short}
            </text>
          )}
        </g>
      ))}
    </svg>
  );
};

/** Horizontal score bar with count-up value. */
export const ScoreBar: React.FC<{
  label: string;
  value: number;
  color: string;
  delay?: number;
}> = ({ label, value, color, delay = 0 }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({
    frame: frame - delay,
    fps,
    config: { damping: 200 },
    durationInFrames: 32,
  });
  return (
    <div style={{ marginBottom: 16 }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          fontSize: 19,
          marginBottom: 8,
        }}
      >
        <span style={{ color: C.fg, fontWeight: 500 }}>{label}</span>
        <span style={{ color, fontFamily: display, fontWeight: 700 }}>
          {Math.round(value * s)}
        </span>
      </div>
      <div
        style={{
          height: 9,
          borderRadius: 9,
          background: "rgba(255,255,255,0.06)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: `${value * s}%`,
            height: "100%",
            borderRadius: 9,
            background: `linear-gradient(90deg, ${color}, ${C.tealSoft})`,
          }}
        />
      </div>
    </div>
  );
};
