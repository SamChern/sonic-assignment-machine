import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import {
  DEFAULT_RESONANCE_DEFINITION,
  RESONANCE_AXES,
  type ResonanceDefinition,
} from "@/lib/nextlevel/resonance";

interface Digest {
  id: string;
  week_start: string;
  headline: string | null;
  bullets: unknown;
}

/**
 * Public method page: how one resonance number is worked out, and — when an
 * admin has published them — the weekly notes on what the model learned.
 */
export default function Methodology() {
  const [definition, setDefinition] = useState<ResonanceDefinition>(DEFAULT_RESONANCE_DEFINITION);
  const [digests, setDigests] = useState<Digest[]>([]);

  useEffect(() => {
    void (async () => {
      const [def, notes] = await Promise.all([
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
      ]);
      if (def.data) {
        setDefinition({
          version: def.data.version,
          weights: (def.data.weights ?? {}) as ResonanceDefinition["weights"],
          distance_shape: def.data.distance_shape ?? "euclidean",
        });
      }
      setDigests(notes.data ?? []);
    })();
  }, []);

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
