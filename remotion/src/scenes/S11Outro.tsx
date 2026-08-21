import React from "react";
import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { Scene, Rise, Waveform } from "../components/ui";
import { C, display } from "../theme";

export const S11Outro: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const line = spring({
    frame: frame - 34,
    fps,
    config: { damping: 200 },
    durationInFrames: 50,
  });

  return (
    <Scene>
      <AbsoluteFill
        style={{
          justifyContent: "center",
          paddingLeft: 150,
        }}
      >
        <Rise distance={22}>
          <div
            style={{
              fontFamily: display,
              fontWeight: 700,
              fontSize: 112,
              letterSpacing: -4.5,
              lineHeight: 1,
            }}
          >
            SONICSIM
            <span style={{ color: C.teal }}>.ai</span>
          </div>
        </Rise>

        <div
          style={{
            height: 2,
            marginTop: 30,
            width: interpolate(line, [0, 1], [0, 760]),
            background: `linear-gradient(90deg, ${C.teal}, transparent)`,
          }}
        />

        <Rise delay={44}>
          <div
            style={{
              marginTop: 30,
              fontSize: 36,
              color: C.fg,
              maxWidth: 1000,
              lineHeight: 1.3,
            }}
          >
            The sonic semantic layer for audio audiences.
          </div>
        </Rise>
        <Rise delay={58}>
          <div style={{ marginTop: 16, fontSize: 26, color: C.muted }}>
            sonicsimai.com
          </div>
        </Rise>
      </AbsoluteFill>

      <div style={{ position: "absolute", bottom: 90, right: 90 }}>
        <Waveform
          width={620}
          height={150}
          bars={44}
          color={C.teal}
          opacity={0.3}
          speed={0.08}
          seed={9}
        />
      </div>
    </Scene>
  );
};
