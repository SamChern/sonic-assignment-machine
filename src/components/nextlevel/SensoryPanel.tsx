import { useMemo, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AxisVectorEditor } from "./AxisVectorEditor";
import { playVibration, sensorySignature } from "@/lib/nextlevel/sensory";
import type { AxisVector } from "@/lib/nextlevel/resonance";

/**
 * Signatures beyond hearing (item 7): the same six axes rendered as a vibration
 * pattern and a light pattern, so the signature can be felt and seen.
 */
export function SensoryPanel() {
  const [vector, setVector] = useState<AxisVector>({
    emotional: 70,
    cognitive: 55,
    social: 62,
    communication: 40,
    contextual: 75,
    artistic: 68,
  });
  const [playingIndex, setPlayingIndex] = useState<number | null>(null);
  const signature = useMemo(() => sensorySignature(vector), [vector]);

  const play = () => {
    playVibration(signature.vibration);
    let i = 0;
    setPlayingIndex(0);
    const step = () => {
      i += 1;
      if (i >= signature.light.length) {
        setPlayingIndex(null);
        return;
      }
      setPlayingIndex(i);
      const wait = signature.light[i].atMs - signature.light[i - 1].atMs;
      window.setTimeout(step, Math.max(30, wait));
    };
    window.setTimeout(step, signature.light[1] ? signature.light[1].atMs : 200);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Felt and seen signatures</CardTitle>
        <CardDescription>
          The same identity as the three-second sound, expressed as a vibration pattern and a light
          pattern — so it works without hearing.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid gap-6 md:grid-cols-2">
          <AxisVectorEditor title="Subject" value={vector} onChange={setVector} />
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary">{signature.bpm} pulses per minute</Badge>
              <Badge variant="outline">{signature.light.length} beats</Badge>
              <Badge variant="outline">{(signature.durationMs / 1000).toFixed(1)}s</Badge>
            </div>
            <div className="flex flex-wrap gap-1" aria-label="Light pattern preview">
              {signature.light.map((k, i) => (
                <span
                  key={`${k.atMs}-${i}`}
                  title={`${k.axis} at ${k.atMs}ms`}
                  className="h-6 w-6 rounded-sm transition-transform"
                  style={{
                    background: k.color,
                    opacity: k.intensity,
                    transform: playingIndex === i ? "scale(1.35)" : "scale(1)",
                  }}
                />
              ))}
            </div>
            <Button onClick={play} size="sm">
              Play pattern
            </Button>
            <p className="text-xs text-muted-foreground">
              Vibration only fires on devices that support it; the light pattern always plays.
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
