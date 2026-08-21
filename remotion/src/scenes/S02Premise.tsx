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

const GENRES = ["Pop", "Rock", "Hip-hop", "Jazz", "Talk", "Sports"];

export const S02Premise: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const flip = spring({
    frame: frame - 56,
    fps,
    config: { damping: 200 },
    durationInFrames: 34,
  });

  return (
    <Scene>
      <AbsoluteFill
        style={{
          flexDirection: "row",
          alignItems: "center",
          padding: "0 120px",
          gap: 70,
        }}
      >
        <div style={{ maxWidth: 720 }}>
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
              Why it exists
            </div>
          </Rise>
          <Rise delay={6}>
            <div
              style={{
                fontFamily: display,
                fontWeight: 700,
                fontSize: 76,
                lineHeight: 1.02,
                letterSpacing: -2.6,
                marginTop: 18,
              }}
            >
              Genres describe
              <br />
              catalogs.
            </div>
          </Rise>
          <Rise delay={14}>
            <div
              style={{
                fontFamily: display,
                fontWeight: 700,
                fontSize: 76,
                lineHeight: 1.02,
                letterSpacing: -2.6,
                color: C.teal,
                marginTop: 6,
              }}
            >
              We describe people.
            </div>
          </Rise>
          <Rise delay={26}>
            <div
              style={{
                marginTop: 26,
                fontSize: 27,
                lineHeight: 1.45,
                color: C.muted,
                maxWidth: 640,
              }}
            >
              SonicSIM replaces genre labels with an ontology of how audio
              actually relates to human experience.
            </div>
          </Rise>
        </div>

        <div style={{ display: "grid", gap: 14, width: 560 }}>
          {GENRES.map((g, i) => {
            const cat = CATS[i]!;
            const local = interpolate(
              flip,
              [0, 1],
              [0, 1],
            ) as number;
            const s = spring({
              frame: frame - 8 - i * 5,
              fps,
              config: { damping: 200 },
              durationInFrames: 26,
            });
            return (
              <div
                key={g}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "18px 24px",
                  borderRadius: 16,
                  border: `1px solid ${C.line}`,
                  background: `linear-gradient(120deg, rgba(255,255,255,0.03), rgba(255,255,255,0.01))`,
                  opacity: s,
                  transform: `translateX(${interpolate(s, [0, 1], [40, 0])}px)`,
                }}
              >
                <span
                  style={{
                    fontSize: 24,
                    color: C.muted,
                    textDecoration: local > 0.5 ? "line-through" : "none",
                    opacity: interpolate(local, [0, 1], [1, 0.45]),
                  }}
                >
                  {g}
                </span>
                <span
                  style={{
                    fontFamily: display,
                    fontWeight: 700,
                    fontSize: 24,
                    color: cat.color,
                    opacity: local,
                    transform: `translateX(${interpolate(local, [0, 1], [26, 0])}px)`,
                  }}
                >
                  {cat.name}
                </span>
              </div>
            );
          })}
        </div>
      </AbsoluteFill>
    </Scene>
  );
};
