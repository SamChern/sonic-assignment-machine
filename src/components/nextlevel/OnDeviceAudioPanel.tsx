import { useMemo, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Cpu, Loader2, ShieldCheck } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { invokeWithTimeout } from "@/lib/invokeWithTimeout";
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
interface ServerMatch {
  success: boolean;
  saved?: boolean;
  save_error?: string;
  error?: unknown;
  scores: Record<string, number>;
  confidence: number;
  definition_version: string;
  match: {
    score: number;
    gaps: Record<string, number>;
    weakestAxis: string;
  };
}

export function OnDeviceAudioPanel() {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<AudioFingerprint | null>(null);
  const [label, setLabel] = useState("");
  const [save, setSave] = useState(false);
  const [publicExample, setPublicExample] = useState(false);
  const [server, setServer] = useState<ServerMatch | null>(null);
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
    setServer(null);
    try {
      const fingerprint = await encodeAudioFile(file);
      setResult(fingerprint);

      // The browser measured it; the backend is the authority on what those
      // measurements mean, and stores the run when asked.
      const { data, error } = await invokeWithTimeout<ServerMatch>(
        "resonance-encode",
        {
          action: "score",
          features: fingerprint.features,
          audience,
          label: label.trim() || file.name,
          persist: save,
          public_example: save && publicExample,
        },
        { timeoutMs: 30000 },
      );
      if (error) throw error;
      if (data?.success) {
        setServer(data);
        if (data.save_error) toast.warning(data.save_error);
        else if (data.saved) toast.success("Measured here, confirmed and saved as a worked example.");
        else toast.success("Measured on this device and confirmed by the backend.");
      } else {
        throw new Error(data?.error ? String(data.error) : "The match could not be confirmed.");
      }
    } catch (e) {
      toast.error(friendlyError(e, "We couldn't read that sound in this browser."));
    } finally {
      setBusy(false);
    }
  };

  const f = result?.features;
  const shown = server
    ? { scores: server.scores, gaps: server.match.gaps, score: server.match.score, weakest: server.match.weakestAxis, confidence: server.confidence }
    : result && match
      ? { scores: result.scores, gaps: match.gaps, score: match.score, weakest: match.weakestAxis, confidence: result.confidence }
      : null;

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

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="ondevice-label">Name this run (optional)</Label>
            <Input
              id="ondevice-label"
              value={label}
              placeholder="e.g. Album intro, take 2"
              onChange={(e) => setLabel(e.target.value)}
            />
          </div>
          <div className="space-y-2 rounded-md border p-3">
            <div className="flex items-center justify-between gap-3">
              <Label htmlFor="ondevice-save" className="text-sm">Keep this run</Label>
              <Switch id="ondevice-save" checked={save} onCheckedChange={setSave} />
            </div>
            <div className="flex items-center justify-between gap-3">
              <Label htmlFor="ondevice-public" className="text-sm text-muted-foreground">
                Show it as a public worked example
              </Label>
              <Switch
                id="ondevice-public"
                checked={publicExample}
                disabled={!save}
                onCheckedChange={setPublicExample}
              />
            </div>
          </div>
        </div>

        <AxisVectorEditor title="Audience" value={audience} onChange={setAudience} />

        {shown && f && (
          <div className="space-y-3 rounded-lg border bg-muted/40 p-4">
            <div className="flex flex-wrap items-baseline gap-3">
              <span className="text-3xl font-semibold tabular-nums text-primary">{shown.score}</span>
              <span className="text-sm text-muted-foreground">{resonanceWording(shown.score)}</span>
              <Badge variant="secondary">measured here</Badge>
              <Badge variant="outline">confidence {Math.round(shown.confidence * 100)}%</Badge>
              {server && (
                <Badge variant="outline" className="gap-1">
                  <ShieldCheck className="h-3 w-3" aria-hidden="true" />
                  confirmed ({server.definition_version})
                </Badge>
              )}
            </div>

            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {RESONANCE_AXES.map((axis) => (
                <div key={axis} className="rounded-md border bg-background p-2">
                  <p className="text-xs capitalize text-muted-foreground">{axis}</p>
                  <p className="text-lg font-semibold tabular-nums">{shown.scores[axis]}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {shown.gaps[axis] > 0 ? "+" : ""}
                    {shown.gaps[axis]} vs audience
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
              Held back most by <span className="capitalize text-foreground">{shown.weakest}</span>.
              Up to the first minute of audio is measured.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
