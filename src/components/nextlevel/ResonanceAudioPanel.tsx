import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Loader2, Music, Upload } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { invokeWithTimeout } from "@/lib/invokeWithTimeout";
import { friendlyError } from "@/lib/friendlyError";
import type { AnalyzeAudioResponse, AnalyzeAudioSource } from "@/lib/analyzeAudio";
import { AxisVectorEditor } from "./AxisVectorEditor";
import {
  DEFAULT_RESONANCE_DEFINITION,
  RESONANCE_AXES,
  resonancePoint,
  resonanceWording,
  type AxisVector,
  type ResonanceDefinition,
} from "@/lib/nextlevel/resonance";

const BUCKET = "admin-audio-tests";
const MAX_BYTES = 20 * 1024 * 1024;

const AXIS_BY_NAME: Record<string, keyof AxisVector> = {
  emotional: "emotional",
  cognitive: "cognitive",
  social: "social",
  communication: "communication",
  contextual: "contextual",
  artistic: "artistic",
};

function toVector(source: AnalyzeAudioSource): AxisVector {
  const v: AxisVector = {};
  for (const cat of source.categories ?? []) {
    const axis = AXIS_BY_NAME[String(cat.name).toLowerCase()];
    if (axis) v[axis] = Number(cat.score) || 0;
  }
  return v;
}

/**
 * Real audio into the Lab: upload a sound, run the live analysis pipeline on it
 * (so the six scores come from the audio, not sliders), then match it against an
 * audience. Saving the run makes it a worked example on the public method page.
 */
export function ResonanceAudioPanel() {
  const [definition, setDefinition] = useState<ResonanceDefinition>(DEFAULT_RESONANCE_DEFINITION);
  const [file, setFile] = useState<File | null>(null);
  const [running, setRunning] = useState(false);
  const [publish, setPublish] = useState(true);
  const [analysed, setAnalysed] = useState<AnalyzeAudioSource | null>(null);
  const [audience, setAudience] = useState<AxisVector>({
    emotional: 55,
    cognitive: 60,
    social: 58,
    communication: 52,
    contextual: 70,
    artistic: 48,
  });

  useEffect(() => {
    void (async () => {
      const { data } = await supabase
        .from("resonance_definitions")
        .select("version, weights, distance_shape")
        .eq("is_active", true)
        .maybeSingle();
      if (data) {
        setDefinition({
          version: data.version,
          weights: (data.weights ?? {}) as ResonanceDefinition["weights"],
          distance_shape: data.distance_shape ?? "euclidean",
        });
      }
    })();
  }, []);

  const contentVector = useMemo(() => (analysed ? toVector(analysed) : null), [analysed]);
  const result = useMemo(
    () => (contentVector ? resonancePoint(contentVector, audience, definition) : null),
    [contentVector, audience, definition],
  );

  const run = async () => {
    if (!file) return;
    if (file.size > MAX_BYTES) {
      toast.error(`That file is ${(file.size / 1024 / 1024).toFixed(1)} MB. The limit is 20 MB.`);
      return;
    }
    setRunning(true);
    setAnalysed(null);

    const { data: userData } = await supabase.auth.getUser();
    const userId = userData.user?.id;
    const path = `${userId ?? "anon"}/${Date.now()}-${file.name.replace(/[^\w.\-]/g, "_")}`;

    try {
      const { error: upErr } = await supabase.storage
        .from(BUCKET)
        .upload(path, file, { contentType: file.type || "application/octet-stream" });
      if (upErr) throw new Error(upErr.message);

      const { data: signed, error: signErr } = await supabase.storage
        .from(BUCKET)
        .createSignedUrl(path, 3600);
      if (signErr || !signed?.signedUrl) throw new Error(signErr?.message ?? "Could not sign the file");

      const { data, error } = await invokeWithTimeout<AnalyzeAudioResponse>("analyze-audio", {
        body: {
          sources: [{ name: file.name, type: "file", file_url: signed.signedUrl }],
          user_id: userId,
          save_results: publish && !!userId,
        },
        timeoutMs: 180_000,
      });
      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error);
      const source = data?.sources?.[0];
      if (!source?.categories?.length) throw new Error("The analysis came back without scores");

      setAnalysed(source);
      toast.success(
        publish
          ? "Scored from the audio and saved as a worked example."
          : "Scored from the audio.",
      );
    } catch (e) {
      toast.error(friendlyError(e, "We couldn't score that sound. Please try again."));
    } finally {
      setRunning(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Music className="h-5 w-5 text-primary" aria-hidden="true" />
          Match a real sound
          <Badge variant="outline">{definition.version}</Badge>
        </CardTitle>
        <CardDescription>
          Upload a sound and the six scores come from the audio itself. The match below then compares
          those scores with the audience you set.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
          <div className="space-y-1.5">
            <Label htmlFor="lab-audio">Audio file (up to 20 MB)</Label>
            <Input
              id="lab-audio"
              type="file"
              accept="audio/*"
              disabled={running}
              onChange={(e) => {
                setAnalysed(null);
                setFile(e.target.files?.[0] ?? null);
              }}
            />
          </div>
          <Button onClick={run} disabled={!file || running}>
            {running ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <Upload className="mr-2 h-4 w-4" aria-hidden="true" />
            )}
            Score this sound
          </Button>
        </div>

        <div className="flex items-center gap-3">
          <Switch
            id="lab-publish"
            checked={publish}
            onCheckedChange={setPublish}
            aria-label="Save this run as a worked example on the public method page"
          />
          <Label htmlFor="lab-publish" className="text-sm text-muted-foreground">
            Keep this run so it appears as a worked example on the method page
          </Label>
        </div>

        <AxisVectorEditor title="Audience" value={audience} onChange={setAudience} />

        {contentVector && result && (
          <div className="rounded-lg border bg-muted/40 p-4">
            <div className="flex flex-wrap items-baseline gap-3">
              <span className="text-3xl font-semibold tabular-nums text-primary">{result.score}</span>
              <span className="text-sm text-muted-foreground">{resonanceWording(result.score)}</span>
              {analysed?.grounding_level && (
                <Badge variant="secondary">{analysed.grounding_level}</Badge>
              )}
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              Scores heard in <span className="text-foreground">{analysed?.name}</span>:
            </p>
            <div className="mt-2 grid grid-cols-2 gap-1 text-xs text-muted-foreground sm:grid-cols-3">
              {RESONANCE_AXES.map((axis) => (
                <span key={axis} className="capitalize">
                  {axis}: <span className="text-foreground">{Math.round(contentVector[axis] ?? 0)}</span>{" "}
                  ({result.gaps[axis] > 0 ? "+" : ""}
                  {result.gaps[axis]})
                </span>
              ))}
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              Held back most by{" "}
              <span className="capitalize text-foreground">{result.weakestAxis}</span>.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
