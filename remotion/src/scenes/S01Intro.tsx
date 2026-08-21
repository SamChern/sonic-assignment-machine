import React from "react";
import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { Scene, Rise, Waveform, useDrift } from "../components/ui";
import { C, display } from "../theme";

export const S01Intro: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const sweep = spring({
    frame: frame - 20,
    fps,
    config: { damping: 200 },
    durationInFrames: 60,
  });
  const drift = useDrift(9, 0.02);
  const letters = "SONICSIM".split("");

  return (
    <Scene>
      <AbsoluteFill
        style={{
          justifyContent: "center",
          paddingLeft: 150,
          transform: `translateY(${drift * 0.4}px)`,
        }}
      >
        <div
          style={{
            position: "relative",
            width: 1080,
            height: 210,
            display: "flex",
            alignItems: "center",
          }}
        >
          <div style={{ position: "absolute", left: -6, top: 24 }}>
            <Waveform
              width={1010}
              height={168}
              bars={58}
              color={C.deep}
              opacity={interpolate(frame, [0, 26], [0, 0.42], {
                extrapolateRight: "clamp",
              })}
              speed={0.075}
            />
          </div>
          <div style={{ display: "flex", position: "relative" }}>
            {letters.map((l, i) => {
              const s = spring({
                frame: frame - i * 4,
                fps,
                config: { damping: 16, stiffness: 140 },
              });
              return (
                <span
                  key={i}
                  style={{
                    fontFamily: display,
                    fontWeight: 700,
                    fontSize: 138,
                    letterSpacing: -6,
                    color: i > 5 ? C.teal : C.fg,
                    opacity: s,
                    display: "inline-block",
                    transform: `translateY(${interpolate(s, [0, 1], [90, 0])}px)`,
                    textShadow: "0 22px 60px rgba(0,0,0,0.8)",
                  }}
                >
                  {l}
                </span>
              );
            })}
            <span
              style={{
                fontFamily: display,
                fontWeight: 500,
                fontSize: 56,
                color: C.teal,
                alignSelf: "flex-start",
                marginTop: 34,
                marginLeft: 10,
                opacity: interpolate(frame, [34, 50], [0, 1], {
                  extrapolateRight: "clamp",
                }),
              }}
            >
              .ai
            </span>
          </div>
        </div>

        <div
          style={{
            height: 2,
            marginTop: 26,
            width: interpolate(sweep, [0, 1], [0, 700]),
            background: `linear-gradient(90deg, ${C.teal}, transparent)`,
          }}
        />

        <Rise delay={40}>
          <div
            style={{
              marginTop: 30,
              fontSize: 34,
              color: C.muted,
              maxWidth: 900,
              lineHeight: 1.35,
            }}
          >
            The sonic semantic layer — audio understood the way humans
            experience it.
          </div>
        </Rise>
      </AbsoluteFill>
    </Scene>
  );
};
