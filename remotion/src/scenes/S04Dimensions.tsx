import React from "react";
import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { Scene, Rise } from "../components/ui";
import { C, CATS, display } from "../theme";

const COPY = [
  "Feeling carried by the sound",
  "Complexity, structure, thought",
  "Belonging and shared context",
  "Voice, lyric, spoken meaning",
  "Where and when it belongs",
  "Craft, texture, intention",
];

export const S04Dimensions: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  return (
    <Scene>
      <AbsoluteFill style={{ padding: "80px 120px", justifyContent: "center" }}>
        <Rise distance={16}>
          <div
            style={{
              fontWeight: 700,
              letterSpacing: 4,
              textTransform: "uppercase",
              fontSize: 18,
              color: C.teal,
            }}
          >
            The semantic layer
          </div>
        </Rise>
        <Rise delay={6}>
          <div
            style={{
              fontFamily: display,
              fontWeight: 700,
              fontSize: 78,
              letterSpacing: -2.6,
              marginTop: 16,
            }}
          >
            Six dimensions. Every signal scored.
          </div>
        </Rise>

        <div
          style={{
            marginTop: 54,
            display: "grid",
            gridTemplateColumns: "repeat(3, 1fr)",
            gap: 22,
          }}
        >
          {CATS.map((cat, i) => {
            const s = spring({
              frame: frame - 26 - i * 8,
              fps,
              config: { damping: 18, stiffness: 150 },
            });
            const pulse =
              1 + Math.sin((frame - i * 12) * 0.06) * 0.035;
            return (
              <div
                key={cat.name}
                style={{
                  borderRadius: 20,
                  padding: "26px 26px 30px",
                  border: `1px solid ${C.line}`,
                  background: `linear-gradient(160deg, rgba(255,255,255,0.035), rgba(255,255,255,0.008))`,
                  opacity: s,
                  transform: `translateY(${interpolate(s, [0, 1], [46, 0])}px)`,
                }}
              >
                <div
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: 14,
                    background: cat.color,
                    opacity: 0.9,
                    transform: `scale(${pulse})`,
                    boxShadow: `0 12px 34px -10px ${cat.color}`,
                  }}
                />
                <div
                  style={{
                    fontFamily: display,
                    fontWeight: 700,
                    fontSize: 32,
                    marginTop: 20,
                    letterSpacing: -0.8,
                  }}
                >
                  {cat.name}
                </div>
                <div
                  style={{
                    marginTop: 10,
                    fontSize: 20,
                    color: C.muted,
                    lineHeight: 1.4,
                  }}
                >
                  {COPY[i]}
                </div>
              </div>
            );
          })}
        </div>
      </AbsoluteFill>
    </Scene>
  );
};
