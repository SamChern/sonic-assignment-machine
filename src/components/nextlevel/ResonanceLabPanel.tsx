import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { AxisVectorEditor } from "./AxisVectorEditor";
import {
  DEFAULT_RESONANCE_DEFINITION,
  RESONANCE_AXES,
  resonanceIndex,
  resonancePoint,
  resonanceWording,
  type AxisVector,
  type ResonanceDefinition,
} from "@/lib/nextlevel/resonance";

const seed: AxisVector = {
  emotional: 62,
  cognitive: 58,
  social: 66,
  communication: 44,
  contextual: 78,
  artistic: 51,
};

/**
 * Resonance Point (item 1): one auditable score for how close a piece of
 * content sits to an audience, under the stored weight set. The Resonance Index
 * below is the mean of that score over the most recent real analyses.
 */
export function ResonanceLabPanel() {
  const [definition, setDefinition] = useState<ResonanceDefinition>(DEFAULT_RESONANCE_DEFINITION);
  const [content, setContent] = useState<AxisVector>(seed);
  const [audience, setAudience] = useState<AxisVector>({
    emotional: 55,
    cognitive: 60,
    social: 58,
    communication: 52,
    contextual: 70,
    artistic: 48,
  });
  const [recent, setRecent] = useState<AxisVector[]>([]);
  const [loading, setLoading] = useState(false);

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

  const result = useMemo(
    () => resonancePoint(content, audience, definition),
    [content, audience, definition],
  );
  const index = useMemo(() => resonanceIndex(recent, audience, definition), [recent, audience, definition]);

  const loadRecent = async () => {
    setLoading(true);
    const { data } = await supabase
      .from("source_analyses")
      .select(
        "emotional_score, cognitive_score, social_score, communication_score, contextual_score, artistic_score",
      )
      .order("created_at", { ascending: false })
      .limit(200);
    setRecent(
      (data ?? []).map((r) => ({
        emotional: r.emotional_score ?? 0,
        cognitive: r.cognitive_score ?? 0,
        social: r.social_score ?? 0,
        communication: r.communication_score ?? 0,
        contextual: r.contextual_score ?? 0,
        artistic: r.artistic_score ?? 0,
      })),
    );
    setLoading(false);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Resonance Point
          <Badge variant="outline">{definition.version}</Badge>
        </CardTitle>
        <CardDescription>
          One auditable number per impression: the weighted six-axis distance between what is
          playing and who is listening. Weights come from the stored definition, so any score can be
          recomputed later.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid gap-6 md:grid-cols-2">
          <AxisVectorEditor title="Content" value={content} onChange={setContent} />
          <AxisVectorEditor title="Audience" value={audience} onChange={setAudience} />
        </div>

        <div className="rounded-lg border bg-muted/40 p-4">
          <div className="flex flex-wrap items-baseline gap-3">
            <span className="text-3xl font-semibold tabular-nums text-primary">{result.score}</span>
            <span className="text-sm text-muted-foreground">{resonanceWording(result.score)}</span>
            <Badge variant="secondary">distance {result.distance}</Badge>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            Held back most by <span className="capitalize text-foreground">{result.weakestAxis}</span>{" "}
            ({result.gaps[result.weakestAxis] > 0 ? "+" : ""}
            {result.gaps[result.weakestAxis]} vs the audience).
          </p>
          <div className="mt-3 grid grid-cols-2 gap-1 text-xs text-muted-foreground sm:grid-cols-3">
            {RESONANCE_AXES.map((axis) => (
              <span key={axis} className="capitalize">
                {axis}: {result.gaps[axis] > 0 ? "+" : ""}
                {result.gaps[axis]}
              </span>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Button variant="outline" size="sm" onClick={loadRecent} disabled={loading}>
            {loading ? "Reading analyses…" : "Resonance Index over recent analyses"}
          </Button>
          {index.count > 0 && (
            <p className="text-sm text-muted-foreground">
              Mean resonance <span className="font-semibold text-foreground">{index.index}</span>{" "}
              across {index.count} scored sources.
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
