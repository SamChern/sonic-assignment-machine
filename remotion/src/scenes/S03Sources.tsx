import React from "react";
import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { Scene, Super, Waveform } from "../components/ui";
import { C, display } from "../theme";

const SOURCES = [
  { t: "Upload", s: "WAV · MP3 · FLAC" },
  { t: "Spotify", s: "Catalog + audio features" },
  { t: "Apple Music", s: "Catalog search" },
  { t: "CTV feeds", s: "Device-level signals" },
  { t: "S3 / Parquet", s: "Partner activations" },
];

export const S03Sources: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  return (
    <Scene>
      <AbsoluteFill style={{ padding: "88px 120px", justifyContent: "center" }}>
        <Super
          kicker="Any source in"
          title="One pipeline for every kind of audio signal."
          line="Songs, spoken word, CTV streams and partner taxonomies land in the same semantic pipeline."
          width={980}
        />

        <div style={{ display: "flex", gap: 20, marginTop: 56 }}>
          {SOURCES.map((src, i) => {
            const s = spring({
              frame: frame - 30 - i * 7,
              fps,
              config: { damping: 20, stiffness: 150 },
            });
            const active = spring({
              frame: frame - 76 - i * 9,
              fps,
              config: { damping: 200 },
              durationInFrames: 22,
            });
            return (
              <div
                key={src.t}
                style={{
                  flex: 1,
                  height: 250,
                  borderRadius: 20,
                  padding: 24,
                  boxSizing: "border-box",
                  border: `1px solid ${
                    active > 0.4 ? "rgba(94,207,192,0.5)" : C.line
                  }`,
                  background: `linear-gradient(165deg, rgba(94,207,192,${
                    0.03 + active * 0.07
                  }), rgba(255,255,255,0.012))`,
                  opacity: s,
                  transform: `translateY(${interpolate(s, [0, 1], [50, 0])}px) scale(${interpolate(
                    s,
                    [0, 1],
                    [0.94, 1],
                  )})`,
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "space-between",
                }}
              >
                <div>
                  <div
                    style={{
                      fontFamily: display,
                      fontWeight: 700,
                      fontSize: 30,
                      letterSpacing: -0.8,
                    }}
                  >
                    {src.t}
                  </div>
                  <div style={{ marginTop: 10, fontSize: 19, color: C.muted }}>
                    {src.s}
                  </div>
                </div>
                <Waveform
                  width={230}
                  height={62}
                  bars={26}
                  color={C.teal}
                  opacity={0.2 + active * 0.6}
                  speed={0.1 + i * 0.012}
                  seed={i + 2}
                />
              </div>
            );
          })}
        </div>
      </AbsoluteFill>
    </Scene>
  );
};
