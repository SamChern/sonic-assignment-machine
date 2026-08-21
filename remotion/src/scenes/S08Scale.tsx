import React from "react";
import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { Scene, Super, noise } from "../components/ui";
import { C, CATS, display } from "../theme";

const DOTS = Array.from({ length: 220 }, (_, i) => ({
  gx: 60 + (i % 22) * 40,
  gy: 90 + Math.floor(i / 22) * 46,
  c: Math.floor(Math.abs(noise(i + 5)) * 6) % 6,
  cluster: i % 4,
}));

const HUBS = [
  { x: 220, y: 190 },
  { x: 620, y: 150 },
  { x: 300, y: 470 },
  { x: 680, y: 440 },
];

export const S08Scale: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const collapse = spring({
    frame: frame - 60,
    fps,
    config: { damping: 200 },
    durationInFrames: 60,
  });

  return (
    <Scene>
      <AbsoluteFill
        style={{
          flexDirection: "row",
          alignItems: "center",
          padding: "0 110px",
          gap: 56,
        }}
      >
        <Super
          kicker="Identifier-level scale"
          title={"10,000 devices\nroll up into\nmeta-fingerprints."}
          line="Signals are hashed to anonymous IDs, sub-clustered, then aggregated into cohort fingerprints — no raw identifiers ever surfaced."
          width={620}
        />

        <div style={{ width: 940, height: 620, position: "relative" }}>
          <svg width={940} height={620}>
            {DOTS.map((d, i) => {
              const hub = HUBS[d.cluster]!;
              const s = spring({
                frame: frame - i * 0.4,
                fps,
                config: { damping: 200 },
                durationInFrames: 22,
              });
              const x = interpolate(collapse, [0, 1], [d.gx, hub.x + noise(i) * 90]);
              const y = interpolate(collapse, [0, 1], [d.gy, hub.y + noise(i + 2) * 90]);
              return (
                <circle
                  key={i}
                  cx={x}
                  cy={y}
                  r={4.5 * s}
                  fill={CATS[d.c]!.color}
                  opacity={interpolate(collapse, [0, 1], [0.75, 0.35])}
                />
              );
            })}
            {HUBS.map((h, i) => {
              const s = spring({
                frame: frame - 96 - i * 8,
                fps,
                config: { damping: 16, stiffness: 140 },
              });
              return (
                <g key={i}>
                  <circle
                    cx={h.x + 45}
                    cy={h.y + 45}
                    r={62 * s}
                    fill="rgba(94,207,192,0.14)"
                    stroke={C.teal}
                    strokeWidth={2}
                  />
                  <text
                    x={h.x + 45}
                    y={h.y + 51}
                    textAnchor="middle"
                    fill={C.fg}
                    opacity={s}
                    style={{ fontFamily: display, fontSize: 22, fontWeight: 700 }}
                  >
                    SIG-{(i + 1) * 1174}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>
      </AbsoluteFill>
    </Scene>
  );
};
