import { useMemo, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Cpu, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { friendlyError } from "@/lib/friendlyError";
import { AxisVectorEditor } from "./AxisVectorEditor";
import { encodeAudioFile, type AudioFingerprint } from "@/lib/nextlevel/audioEncoder";
import {
  DEFAULT_RESONANCE_DEFINITION,
  RESONANCE_AXES,
  resonancePoint,
  resonanceWording,
  type AxisVector,
} from "@/lib/nextlevel/resonance";

/**
 * On-device audio encoder: decodes the uploaded file in this browser, measures
 * it, and runs the full six-axis match locally — no upload, no model call.
 */
export function OnDeviceAudioPanel() {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<AudioFingerprint | null>(null);
  const [audience, setAudience] = useState<AxisVector>({
    emotional: 55,
    cognitive: 60,
    social: 58,
    communication: 52,
    contextual: 70,
    artistic: 48,
  });

  const match = useMemo(
    () => (result ? resonancePoint(result.scores, audience, DEFAULT_RESONANCE_DEFINITION) : null),
    [result, audience],
  );

  const run = async () => {
    if (!file) return;
    setBusy(true);
    setResult(null);
    try {
      const fingerprint = await encodeAudioFile(file);
      setResult(fingerprint);
      toast.success("Measured on this device — nothing was uploaded.");
    } catch (e) {
      toast.error(friendlyError(e, "We couldn't read that sound in this browser."));
    } finally {
      setBusy(false);
    }
  };

  const f = result?.features;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Cpu className="h-5 w-5 text-primary" aria-hidden="true" />
          Measure a sound on this device
        </CardTitle>
        <CardDescription>
          The file is decoded and measured right here — loudness, brightness, noisiness, voice and
          rhythm — then matched to the audience below. Nothing is sent anywhere and it costs nothing
          to run.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
          <div className="space-y-1.5">
            <Label htmlFor="ondevice-audio">Audio file</Label>
            <Input
              id="ondevice-audio"
              type="file"
              accept="audio/*"
              disabled={busy}
              onChange={(e) => {
                setResult(null);
                setFile(e.target.files?.[0] ?? null);
              }}
            />
          </div>
          <Button onClick={run} disabled={!file || busy}>
            {busy ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <Cpu className="mr-2 h-4 w-4" aria-hidden="true" />
            )}
            Measure and match
          </Button>
        </div>

        <AxisVectorEditor title="Audience" value={audience} onChange={setAudience} />

        {result && match && f && (
          <div className="space-y-3 rounded-lg border bg-muted/40 p-4">
            <div className="flex flex-wrap items-baseline gap-3">
              <span className="text-3xl font-semibold tabular-nums text-primary">{match.score}</span>
              <span className="text-sm text-muted-foreground">{resonanceWording(match.score)}</span>
              <Badge variant="secondary">measured here</Badge>
              <Badge variant="outline">
                confidence {Math.round(result.confidence * 100)}%
              </Badge>
            </div>

            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {RESONANCE_AXES.map((axis) => (
                <div key={axis} className="rounded-md border bg-background p-2">
                  <p className="text-xs capitalize text-muted-foreground">{axis}</p>
                  <p className="text-lg font-semibold tabular-nums">{result.scores[axis]}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {match.gaps[axis] > 0 ? "+" : ""}
                    {match.gaps[axis]} vs audience
                  </p>
                </div>
              ))}
            </div>

            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted-foreground sm:grid-cols-3">
              <span>Length: <span className="text-foreground">{f.durationSec}s</span></span>
              <span>Loudness: <span className="text-foreground">{f.rms}</span></span>
              <span>Dynamics: <span className="text-foreground">{f.dynamicRange}</span></span>
              <span>Brightness: <span className="text-foreground">{f.centroidHz} Hz</span></span>
              <span>Noisiness: <span className="text-foreground">{f.flatness}</span></span>
              <span>Voice band: <span className="text-foreground">{Math.round(f.speechBandRatio * 100)}%</span></span>
              <span>Voiced: <span className="text-foreground">{Math.round(f.voicing * 100)}%</span></span>
              <span>Beats/sec: <span className="text-foreground">{f.onsetRate}</span></span>
              <span>Active: <span className="text-foreground">{Math.round(f.activity * 100)}%</span></span>
            </div>

            <p className="text-xs text-muted-foreground">
              Held back most by <span className="capitalize text-foreground">{match.weakestAxis}</span>.
              Up to the first minute of audio is measured.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
