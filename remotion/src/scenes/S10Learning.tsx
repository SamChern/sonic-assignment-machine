import React from "react";
import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { Scene, Super, Pill } from "../components/ui";
import { C, display } from "../theme";

const STAGES = ["Ingest", "Embed", "Map", "Score", "Learn"];

export const S10Learning: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  return (
    <Scene>
      <AbsoluteFill style={{ padding: "84px 120px", justifyContent: "center" }}>
        <Super
          kicker="It keeps learning"
          title="A memory layer, not a one-off call."
          line="Vector-cached embeddings, Bayesian mapping updates and feedback keep the ontology sharpening without re-querying the source."
          width={1020}
        />

        <div
          style={{
            marginTop: 60,
            display: "flex",
            alignItems: "center",
            gap: 18,
          }}
        >
          {STAGES.map((s, i) => {
            const en = spring({
              frame: frame - 26 - i * 9,
              fps,
              config: { damping: 18, stiffness: 150 },
            });
            return (
              <React.Fragment key={s}>
                <div
                  style={{
                    padding: "26px 30px",
                    borderRadius: 18,
                    border: `1px solid ${C.line}`,
                    background:
                      "linear-gradient(160deg, rgba(94,207,192,0.07), rgba(255,255,255,0.012))",
                    opacity: en,
                    transform: `translateY(${interpolate(en, [0, 1], [36, 0])}px)`,
                    minWidth: 190,
                  }}
                >
                  <div
                    style={{
                      fontSize: 16,
                      letterSpacing: 3,
                      textTransform: "uppercase",
                      color: C.teal,
                    }}
                  >
                    0{i + 1}
                  </div>
                  <div
                    style={{
                      fontFamily: display,
                      fontWeight: 700,
                      fontSize: 34,
                      marginTop: 8,
                      letterSpacing: -1,
                    }}
                  >
                    {s}
                  </div>
                </div>
                {i < STAGES.length - 1 && (
                  <div
                    style={{
                      flex: 1,
                      height: 2,
                      background: `linear-gradient(90deg, ${C.teal}, rgba(94,207,192,0.12))`,
                      opacity: spring({
                        frame: frame - 34 - i * 9,
                        fps,
                        config: { damping: 200 },
                        durationInFrames: 20,
                      }),
                    }}
                  />
                )}
              </React.Fragment>
            );
          })}
        </div>

        <div style={{ display: "flex", gap: 14, marginTop: 46, flexWrap: "wrap" }}>
          <Pill delay={92}>Content-addressed embedding cache</Pill>
          <Pill delay={100}>Zero repeat inference cost</Pill>
          <Pill delay={108}>Confidence you can audit row by row</Pill>
        </div>
      </AbsoluteFill>
    </Scene>
  );
};
