import React from "react";
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { Scene, Super, Panel, Radar, Pill } from "../components/ui";
import { C, display } from "../theme";

const A = [70, 48, 62, 78, 66, 40];
const B = [58, 66, 44, 52, 72, 74];

export const S09Compare: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const score = spring({
    frame: frame - 84,
    fps,
    config: { damping: 200 },
    durationInFrames: 34,
  });

  return (
    <Scene>
      <AbsoluteFill style={{ padding: "80px 120px", justifyContent: "center" }}>
        <Super
          kicker="Compare · discover · activate"
          title="Similarity that survives a genre change."
          line="Overlay any two fingerprints, see the deltas, and find the audiences that actually move together."
          width={1000}
        />

        <div style={{ display: "flex", gap: 28, marginTop: 48, alignItems: "center" }}>
          <Panel delay={22} width={760} height={430} label="Compare fingerprints">
            <div style={{ position: "relative", height: "100%" }}>
              <div style={{ position: "absolute", left: 130, top: -6 }}>
                <Radar values={A} size={370} delay={34} stroke={C.teal} />
              </div>
              <div style={{ position: "absolute", left: 130, top: -6, opacity: 0.85 }}>
                <Radar values={B} size={370} delay={52} stroke="hsl(330, 70%, 60%)" labels={false} />
              </div>
            </div>
          </Panel>

          <div style={{ flex: 1 }}>
            <div
              style={{
                fontFamily: display,
                fontWeight: 700,
                fontSize: 116,
                letterSpacing: -4,
                color: C.teal,
              }}
            >
              {Math.round(78 * score)}%
            </div>
            <div style={{ fontSize: 24, color: C.muted, marginTop: -6 }}>
              semantic similarity
            </div>
            <div style={{ display: "flex", gap: 12, marginTop: 26, flexWrap: "wrap" }}>
              <Pill delay={96}>Fastest mover · Artistic +34</Pill>
              <Pill delay={104}>Comm −26</Pill>
              <Pill delay={112} solid>
                Activation ready
              </Pill>
            </div>
            <div
              style={{
                marginTop: 26,
                fontSize: 21,
                color: C.muted,
                lineHeight: 1.45,
                opacity: interpolate(frame, [110, 130], [0, 1], {
                  extrapolateLeft: "clamp",
                  extrapolateRight: "clamp",
                }),
              }}
            >
              Cohorts export straight back into partner consoles for targeting.
            </div>
          </div>
        </div>
      </AbsoluteFill>
    </Scene>
  );
};
