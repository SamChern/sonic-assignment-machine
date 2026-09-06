import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import {
  DEFAULT_RESONANCE_DEFINITION,
  RESONANCE_AXES,
  resonanceIndex,
  resonancePoint,
  resonanceWording,
  type AxisVector,
  type ResonanceDefinition,
} from "@/lib/nextlevel/resonance";

interface Digest {
  id: string;
  week_start: string;
  headline: string | null;
  bullets: unknown;
}

interface Example {
  id: string;
  name: string;
  grounding: string;
  vector: AxisVector;
}

/**
 * Public method page: how one resonance number is worked out, worked examples
 * from real analysed sounds, and — when an admin has published them — the
 * weekly notes on what the model learned.
 */
export default function Methodology() {
  const [definition, setDefinition] = useState<ResonanceDefinition>(DEFAULT_RESONANCE_DEFINITION);
  const [digests, setDigests] = useState<Digest[]>([]);
  const [examples, setExamples] = useState<Example[]>([]);

  useEffect(() => {
    void (async () => {
      const [def, notes, runs] = await Promise.all([
        supabase
          .from("resonance_definitions")
          .select("version, weights, distance_shape, notes")
          .eq("is_active", true)
          .maybeSingle(),
        supabase
          .from("learning_digests")
          .select("id, week_start, headline, bullets")
          .eq("published", true)
          .order("week_start", { ascending: false })
          .limit(8),
        supabase
          .from("source_analyses")
          .select(
            "id, source_name, grounding_level, emotional_score, cognitive_score, social_score, communication_score, contextual_score, artistic_score",
          )
          .in("grounding_level", ["grounded", "bridged"])
          .order("created_at", { ascending: false })
          .limit(6),
      ]);
      if (def.data) {
        setDefinition({
          version: def.data.version,
          weights: (def.data.weights ?? {}) as ResonanceDefinition["weights"],
          distance_shape: def.data.distance_shape ?? "euclidean",
        });
      }
      setDigests(notes.data ?? []);
      setExamples(
        (runs.data ?? []).map((r) => ({
          id: r.id,
          name: r.source_name,
          grounding: r.grounding_level,
          vector: {
            emotional: r.emotional_score ?? 0,
            cognitive: r.cognitive_score ?? 0,
            social: r.social_score ?? 0,
            communication: r.communication_score ?? 0,
            contextual: r.contextual_score ?? 0,
            artistic: r.artistic_score ?? 0,
          },
        })),
      );
    })();
  }, []);

  // The "audience" for a worked example is the average of the examples shown,
  // so the numbers on this page can be recomputed from what is on screen.
  const audience = useMemo<AxisVector>(() => {
    if (examples.length === 0) return {};
    const out: AxisVector = {};
    for (const axis of RESONANCE_AXES) {
      out[axis] =
        examples.reduce((sum, e) => sum + (e.vector[axis] ?? 0), 0) / examples.length;
    }
    return out;
  }, [examples]);

  const overall = useMemo(
    () => resonanceIndex(examples.map((e) => e.vector), audience, definition),
    [examples, audience, definition],
  );


  return (
    <main className="container mx-auto max-w-3xl space-y-8 px-4 py-10">
      <header className="space-y-3">
        <h1 className="text-3xl font-semibold">How we work out a match</h1>
        <p className="text-muted-foreground">
          Every sound and every audience gets the same six scores. A match is simply how close those
          two sets of six sit to each other — written down, versioned, and open to being checked.
        </p>
        <Button asChild variant="outline" size="sm">
          <Link to="/">Back to SonicSIM</Link>
        </Button>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            The match score
            <Badge variant="outline">{definition.version}</Badge>
          </CardTitle>
          <CardDescription>
            100 means the sound sits exactly where the audience sits. The further apart they are, the
            lower the number.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p>
            Each of the six categories carries a weight, so the categories that matter more to the
            match count for more. The current weights are:
          </p>
          <ul className="grid grid-cols-2 gap-1 sm:grid-cols-3">
            {RESONANCE_AXES.map((axis) => (
              <li key={axis} className="capitalize text-muted-foreground">
                {axis}: <span className="text-foreground">{definition.weights?.[axis] ?? 1}</span>
              </li>
            ))}
          </ul>
          <p className="text-muted-foreground">
            Because the weights are stored rather than hidden in code, any score shown in the product
            can be worked out again later and checked against the version that produced it.
          </p>
        </CardContent>
      </Card>

      {examples.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Worked examples from real sounds</CardTitle>
            <CardDescription>
              The most recently analysed sounds where we listened to real audio. Each match compares
              that sound with the average of the sounds below, so you can follow the arithmetic.
              Average match: <span className="font-semibold text-foreground">{overall.index}</span>{" "}
              across {overall.count}.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {examples.map((e) => {
              const r = resonancePoint(e.vector, audience, definition);
              return (
                <article key={e.id} className="rounded-lg border bg-muted/30 p-3">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <h2 className="text-base font-medium">{e.name}</h2>
                    <Badge variant="secondary">{e.grounding}</Badge>
                    <span className="ml-auto text-xl font-semibold tabular-nums text-primary">
                      {r.score}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {resonanceWording(r.score)}
                    </span>
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-1 text-xs text-muted-foreground sm:grid-cols-3">
                    {RESONANCE_AXES.map((axis) => (
                      <span key={axis} className="capitalize">
                        {axis}:{" "}
                        <span className="text-foreground">{Math.round(e.vector[axis] ?? 0)}</span>
                      </span>
                    ))}
                  </div>
                </article>
              );
            })}
          </CardContent>
        </Card>
      )}



      {digests.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>What SonicSIM learned lately</CardTitle>
            <CardDescription>Published weekly, in plain language.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {digests.map((d) => (
              <article key={d.id} className="space-y-1">
                <h2 className="text-base font-medium">{d.headline}</h2>
                <p className="text-xs text-muted-foreground">Week beginning {d.week_start}</p>
                <ul className="list-disc pl-5 text-sm text-muted-foreground">
                  {(Array.isArray(d.bullets) ? (d.bullets as string[]) : []).map((b, i) => (
                    <li key={i}>{b}</li>
                  ))}
                </ul>
              </article>
            ))}
          </CardContent>
        </Card>
      )}
    </main>
  );
}
