import React from "react";
import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { Scene, Super, Panel, Waveform } from "../components/ui";
import { C, CATS, display } from "../theme";

const RAW = [22, 30, 26, 92, 64, 24];
const NORM = [46, 52, 48, 61, 66, 43];

export const S07Speech: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const mix = spring({
    frame: frame - 72,
    fps,
    config: { damping: 200 },
    durationInFrames: 40,
  });

  return (
    <Scene>
      <AbsoluteFill
        style={{
          flexDirection: "row",
          alignItems: "center",
          padding: "0 110px",
          gap: 60,
        }}
      >
        <Panel
          delay={8}
          width={840}
          height={520}
          label="Speech-skew normalization"
        >
          <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                fontSize: 19,
                color: C.muted,
              }}
            >
              <span>Spoken-word heavy feed</span>
              <span
                style={{
                  color: C.teal,
                  fontFamily: display,
                  fontWeight: 700,
                }}
              >
                speech_bias {(0.62).toFixed(2)}
              </span>
            </div>

            <div
              style={{
                display: "flex",
                alignItems: "flex-end",
                gap: 26,
                height: 300,
                marginTop: 28,
              }}
            >
              {CATS.map((cat, i) => {
                const v = RAW[i]! + (NORM[i]! - RAW[i]!) * mix;
                const enter = spring({
                  frame: frame - 20 - i * 6,
                  fps,
                  config: { damping: 200 },
                  durationInFrames: 26,
                });
                return (
                  <div
                    key={cat.name}
                    style={{ flex: 1, textAlign: "center" }}
                  >
                    <div
                      style={{
                        fontFamily: display,
                        fontWeight: 700,
                        fontSize: 22,
                        color: cat.color,
                        marginBottom: 8,
                      }}
                    >
                      {Math.round(v * enter)}
                    </div>
                    <div
                      style={{
                        height: (v / 100) * 230 * enter,
                        borderRadius: 12,
                        background: `linear-gradient(180deg, ${cat.color}, rgba(255,255,255,0.06))`,
                      }}
                    />
                    <div
                      style={{
                        marginTop: 12,
                        fontSize: 17,
                        color: C.muted,
                      }}
                    >
                      {cat.short}
                    </div>
                  </div>
                );
              })}
            </div>

            <div
              style={{
                marginTop: "auto",
                fontSize: 18,
                color: C.muted,
                opacity: mix,
              }}
            >
              Communication damped · points redistributed across the remaining
              five axes
            </div>
          </div>
        </Panel>

        <Super
          kicker="Bias correction"
          title={"Spoken word\ndoesn't get to\nwin by default."}
          line="CTV and app feeds skew heavily vocal. Per-category gains and an auto-tuned speech bias keep the ontology honest."
          delay={34}
          width={560}
        />
      </AbsoluteFill>
      <div style={{ position: "absolute", bottom: 0, left: 0, right: 0 }}>
        <Waveform
          width={1920}
          height={120}
          bars={110}
          color={C.deep}
          opacity={0.18}
          speed={0.06}
          seed={5}
        />
      </div>
    </Scene>
  );
};
