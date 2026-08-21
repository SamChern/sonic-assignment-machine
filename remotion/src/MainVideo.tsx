import React from "react";
import { AbsoluteFill } from "remotion";
import { TransitionSeries, springTiming } from "@remotion/transitions";
import { wipe } from "@remotion/transitions/wipe";
import { fade } from "@remotion/transitions/fade";
import { S01Intro } from "./scenes/S01Intro";
import { S02Premise } from "./scenes/S02Premise";
import { S03Sources } from "./scenes/S03Sources";
import { S04Dimensions } from "./scenes/S04Dimensions";
import { S05Fingerprint } from "./scenes/S05Fingerprint";
import { S06Network } from "./scenes/S06Network";
import { S07Speech } from "./scenes/S07Speech";
import { S08Scale } from "./scenes/S08Scale";
import { S09Compare } from "./scenes/S09Compare";
import { S10Learning } from "./scenes/S10Learning";
import { S11Outro } from "./scenes/S11Outro";
import { C } from "./theme";

export const SCENES: { c: React.FC; d: number }[] = [
  { c: S01Intro, d: 150 },
  { c: S02Premise, d: 165 },
  { c: S03Sources, d: 165 },
  { c: S04Dimensions, d: 160 },
  { c: S05Fingerprint, d: 185 },
  { c: S06Network, d: 180 },
  { c: S07Speech, d: 175 },
  { c: S08Scale, d: 175 },
  { c: S09Compare, d: 180 },
  { c: S10Learning, d: 165 },
  { c: S11Outro, d: 155 },
];

export const TRANSITION = 18;
export const TOTAL =
  SCENES.reduce((a, s) => a + s.d, 0) - TRANSITION * (SCENES.length - 1);

export const MainVideo: React.FC = () => (
  <AbsoluteFill style={{ backgroundColor: C.ink }}>
    <TransitionSeries>
      {SCENES.map(({ c: Comp, d }, i) => (
        <React.Fragment key={i}>
          <TransitionSeries.Sequence durationInFrames={d}>
            <Comp />
          </TransitionSeries.Sequence>
          {i < SCENES.length - 1 && (
            <TransitionSeries.Transition
              presentation={
                i % 3 === 2
                  ? fade()
                  : wipe({ direction: i % 2 === 0 ? "from-right" : "from-bottom" })
              }
              timing={springTiming({
                config: { damping: 200 },
                durationInFrames: TRANSITION,
              })}
            />
          )}
        </React.Fragment>
      ))}
    </TransitionSeries>
  </AbsoluteFill>
);
