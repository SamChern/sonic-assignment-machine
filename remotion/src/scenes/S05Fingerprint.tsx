import React from "react";
import { AbsoluteFill, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { Scene, Super, Panel, Radar, ScoreBar, Pill } from "../components/ui";
import { C, CATS, display } from "../theme";

const VALUES = [72, 55, 60, 80, 70, 45];

export const S05Fingerprint: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const label = spring({
    frame: frame - 92,
    fps,
    config: { damping: 200 },
    durationInFrames: 24,
  });

  return (
    <Scene>
      <AbsoluteFill
        style={{
          flexDirection: "row",
          alignItems: "center",
          padding: "0 110px",
          gap: 64,
        }}
      >
        <Super
          kicker="Ontological fingerprint"
          title={"Not a tag.\nA measured profile."}
          line="Every source resolves into a six-axis fingerprint with a dominant category and a confidence score you can inspect."
          width={640}
        />

        <Panel delay={12} width={860} height={560} label="Analysis · Paper Bag">
          <div style={{ display: "flex", gap: 34, height: "100%" }}>
            <div style={{ paddingTop: 18 }}>
              <Radar values={VALUES} size={420} delay={30} />
              <div
                style={{
                  marginTop: 6,
                  display: "flex",
                  gap: 10,
                  justifyContent: "center",
                }}
              >
                <Pill delay={94} solid>
                  Communication · 80
                </Pill>
              </div>
            </div>
            <div style={{ flex: 1, paddingTop: 12 }}>
              {CATS.map((cat, i) => (
                <ScoreBar
                  key={cat.name}
                  label={cat.name}
                  value={VALUES[i]!}
                  color={cat.color}
                  delay={40 + i * 7}
                />
              ))}
              <div
                style={{
                  marginTop: 16,
                  fontSize: 18,
                  color: C.muted,
                  opacity: label,
                }}
              >
                <span style={{ fontFamily: display, color: C.teal }}>
                  Confidence 0.84
                </span>{" "}
                · acoustic features fused with semantic evidence
              </div>
            </div>
          </div>
        </Panel>
      </AbsoluteFill>
    </Scene>
  );
};
