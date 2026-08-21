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

type N = { x: number; y: number; r: number; c: number };

const NODES: N[] = Array.from({ length: 34 }, (_, i) => {
  const cluster = i % 6;
  const a = (Math.PI * 2 * cluster) / 6 + noise(i + 3) * 0.8;
  const rad = 150 + Math.abs(noise(i + 7)) * 170;
  return {
    x: 470 + Math.cos(a) * rad + noise(i + 11) * 60,
    y: 300 + Math.sin(a) * rad * 0.78 + noise(i + 13) * 50,
    r: 12 + Math.abs(noise(i + 17)) * 26,
    c: cluster,
  };
});

const LINKS: [number, number][] = [];
for (let i = 0; i < NODES.length; i++) {
  for (let j = i + 1; j < NODES.length; j++) {
    const d = Math.hypot(NODES[i]!.x - NODES[j]!.x, NODES[i]!.y - NODES[j]!.y);
    if (d < 165) LINKS.push([i, j]);
  }
}

export const S06Network: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const settle = spring({
    frame: frame - 14,
    fps,
    config: { damping: 200 },
    durationInFrames: 60,
  });
  const linkReveal = interpolate(frame, [50, 110], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <Scene>
      <AbsoluteFill
        style={{
          flexDirection: "row",
          alignItems: "center",
          padding: "0 100px",
          gap: 40,
        }}
      >
        <div style={{ width: 940, height: 620, position: "relative" }}>
          <svg width={940} height={620} style={{ overflow: "visible" }}>
            {LINKS.map(([a, b], i) => {
              const na = NODES[a]!;
              const nb = NODES[b]!;
              const on = i / LINKS.length < linkReveal ? 1 : 0;
              const w =
                0.8 +
                Math.abs(noise(i + 23)) * 2.4 *
                  (0.8 + Math.sin(frame * 0.05 + i) * 0.2);
              return (
                <line
                  key={i}
                  x1={na.x}
                  y1={na.y}
                  x2={nb.x}
                  y2={nb.y}
                  stroke={CATS[na.c]!.color}
                  strokeWidth={w}
                  opacity={0.26 * on}
                />
              );
            })}
            {NODES.map((n, i) => {
              const s = spring({
                frame: frame - 10 - i * 2,
                fps,
                config: { damping: 15, stiffness: 140 },
              });
              const bob = Math.sin(frame * 0.03 + i) * 6;
              const cx =
                interpolate(settle, [0, 1], [470, n.x]) + bob * 0.4;
              const cy = interpolate(settle, [0, 1], [300, n.y]) + bob;
              return (
                <circle
                  key={i}
                  cx={cx}
                  cy={cy}
                  r={n.r * s}
                  fill={CATS[n.c]!.color}
                  opacity={0.82}
                  stroke={C.ink}
                  strokeWidth={2}
                />
              );
            })}
          </svg>
        </div>

        <Super
          kicker="Ontological identity network"
          title={"Clusters by\nmeaning, not\nby genre."}
          line="Node size is category prevalence; link weight is semantic proximity. Communities emerge from the ontology itself."
          delay={40}
          width={560}
        />
      </AbsoluteFill>
    </Scene>
  );
};
