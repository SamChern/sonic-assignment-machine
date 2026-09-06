import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { friendlyError } from "@/lib/friendlyError";
import { CommonsIntakePanel } from "./CommonsIntakePanel";
import { AxisVectorEditor } from "./AxisVectorEditor";
import {
  DEFAULT_RESONANCE_DEFINITION,
  RESONANCE_AXES,
  resonancePoint,
  resonanceWording,
  type AxisVector,
  type ResonanceDefinition,
} from "@/lib/nextlevel/resonance";

interface PoolItem {
  id: string;
  title: string | null;
  rights_holder: string | null;
  status: string;
  included_at: string | null;
  audio_source_id: string | null;
}

interface Ledger {
  id: string;
  pool_item_id: string | null;
  license: string | null;
  rights_holder: string | null;
  attribution: string | null;
  verified_at: string | null;
}

interface Payout {
  id: string;
  pool_item_id: string | null;
  period_start: string;
  period_end: string;
  inclusions: number | null;
  amount_usd: number | null;
}

interface Scores extends AxisVector {
  grounding_level?: string;
  confidence?: number;
}

/**
 * Sonic Commons (item 2): a governed, rights-cleared pool — real audio in,
 * a licence recorded for every work, an audience match computed from the audio's
 * own six scores, and a payout record per inclusion. Admin door only.
 */
export function CommonsPanel() {
  const [items, setItems] = useState<PoolItem[]>([]);
  const [ledger, setLedger] = useState<Ledger[]>([]);
  const [payouts, setPayouts] = useState<Payout[]>([]);
  const [scores, setScores] = useState<Record<string, Scores>>({});
  const [loading, setLoading] = useState(true);
  const [rate, setRate] = useState(0.25);
  const [definition, setDefinition] = useState<ResonanceDefinition>(DEFAULT_RESONANCE_DEFINITION);
  const [audience, setAudience] = useState<AxisVector>({
    emotional: 55,
    cognitive: 60,
    social: 58,
    communication: 52,
    contextual: 70,
    artistic: 48,
  });

  const load = async () => {
    setLoading(true);
    try {
      const [a, b, c, def] = await Promise.all([
        supabase
          .from("commons_pool_items")
          .select("id, title, rights_holder, status, included_at, audio_source_id")
          .order("created_at", { ascending: false })
          .limit(50),
        supabase
          .from("commons_license_ledger")
          .select("id, pool_item_id, license, rights_holder, attribution, verified_at")
          .order("created_at", { ascending: false })
          .limit(50),
        supabase
          .from("commons_payouts")
          .select("id, pool_item_id, period_start, period_end, inclusions, amount_usd")
          .order("period_start", { ascending: false })
          .limit(50),
        supabase
          .from("resonance_definitions")
          .select("version, weights, distance_shape")
          .eq("is_active", true)
          .maybeSingle(),
      ]);
      const poolItems = a.data ?? [];
      setItems(poolItems);
      setLedger(b.data ?? []);
      setPayouts(c.data ?? []);
      if (def.data) {
        setDefinition({
          version: def.data.version,
          weights: (def.data.weights ?? {}) as ResonanceDefinition["weights"],
          distance_shape: def.data.distance_shape ?? "euclidean",
        });
      }

      const sourceIds = poolItems.map((i) => i.audio_source_id).filter((v): v is string => !!v);
      if (sourceIds.length > 0) {
        const { data: analyses } = await supabase
          .from("source_analyses")
          .select(
            "audio_source_id, emotional_score, cognitive_score, social_score, communication_score, contextual_score, artistic_score, grounding_level, confidence, created_at",
          )
          .in("audio_source_id", sourceIds)
          .order("created_at", { ascending: false });
        const map: Record<string, Scores> = {};
        for (const row of analyses ?? []) {
          const key = row.audio_source_id as string;
          if (!key || map[key]) continue; // newest analysis wins
          map[key] = {
            emotional: Number(row.emotional_score) || 0,
            cognitive: Number(row.cognitive_score) || 0,
            social: Number(row.social_score) || 0,
            communication: Number(row.communication_score) || 0,
            contextual: Number(row.contextual_score) || 0,
            artistic: Number(row.artistic_score) || 0,
            grounding_level: row.grounding_level ?? undefined,
            confidence: Number(row.confidence) || 0,
          };
        }
        setScores(map);
      } else {
        setScores({});
      }
    } catch (err) {
      toast({
        title: "Couldn't load the pool",
        description: friendlyError(err),
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const setStatus = async (id: string, status: string) => {
    const { error } = await supabase
      .from("commons_pool_items")
      .update({ status, included_at: status === "included" ? new Date().toISOString() : null })
      .eq("id", id);
    if (error) {
      toast({ title: "Couldn't update", description: friendlyError(error), variant: "destructive" });
      return;
    }
    await load();
  };

  /** One inclusion this month, at the rate set above, added to the payout record. */
  const recordInclusion = async (itemId: string) => {
    const now = new Date();
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
      .toISOString()
      .slice(0, 10);
    const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0))
      .toISOString()
      .slice(0, 10);

    const existing = payouts.find(
      (p) => p.pool_item_id === itemId && p.period_start === start && p.period_end === end,
    );
    const inclusions = Number(existing?.inclusions ?? 0) + 1;
    const amount = Math.round(inclusions * rate * 10000) / 10000;

    const { error } = existing
      ? await supabase
          .from("commons_payouts")
          .update({ inclusions, amount_usd: amount })
          .eq("id", existing.id)
      : await supabase
          .from("commons_payouts")
          .insert({
            pool_item_id: itemId,
            period_start: start,
            period_end: end,
            inclusions,
            amount_usd: amount,
          });
    if (error) {
      toast({
        title: "Couldn't record the inclusion",
        description: friendlyError(error),
        variant: "destructive",
      });
      return;
    }
    await load();
  };

  const totalPaid = payouts.reduce((sum, p) => sum + Number(p.amount_usd ?? 0), 0);
  const scored = useMemo(
    () => items.filter((i) => i.audio_source_id && scores[i.audio_source_id]).length,
    [items, scores],
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Sonic Commons</CardTitle>
        <CardDescription>
          A shared pool of sound that only ever includes work with clear rights, a recorded licence,
          credit for whoever made it, and a record of what each inclusion earned.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="flex flex-wrap gap-2">
          <Badge variant="secondary">{items.length} works considered</Badge>
          <Badge variant="outline">
            {items.filter((i) => i.status === "included").length} included
          </Badge>
          <Badge variant="outline">{ledger.length} licence records</Badge>
          <Badge variant="outline">{scored} scored from audio</Badge>
          <Badge variant="outline">${totalPaid.toFixed(2)} recorded in payouts</Badge>
          <Badge variant="outline">match {definition.version}</Badge>
        </div>

        <CommonsIntakePanel onAdded={load} />

        <AxisVectorEditor title="Audience to match against" value={audience} onChange={setAudience} />

        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="commons-rate">Payout per inclusion (USD)</Label>
            <Input
              id="commons-rate"
              type="number"
              min={0}
              step={0.01}
              value={rate}
              onChange={(e) => setRate(Math.max(0, Number(e.target.value) || 0))}
              className="w-32"
            />
          </div>
        </div>

        {loading && <p className="text-sm text-muted-foreground">Loading…</p>}
        {!loading && items.length === 0 && (
          <p className="text-sm text-muted-foreground">
            Nothing has been proposed for the pool yet. Add a sound above, or works can enter from the
            creator catalogue once a rights holder opts in.
          </p>
        )}

        <div className="space-y-2">
          {items.map((item) => {
            const licence = ledger.find((l) => l.pool_item_id === item.id);
            const vector = item.audio_source_id ? scores[item.audio_source_id] : undefined;
            const match = vector ? resonancePoint(vector, audience, definition) : null;
            const paid = payouts
              .filter((p) => p.pool_item_id === item.id)
              .reduce((sum, p) => sum + Number(p.amount_usd ?? 0), 0);
            const inclusions = payouts
              .filter((p) => p.pool_item_id === item.id)
              .reduce((sum, p) => sum + Number(p.inclusions ?? 0), 0);

            return (
              <div key={item.id} className="rounded-md border p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">{item.title ?? "Untitled work"}</span>
                  <div className="flex items-center gap-2">
                    {vector?.grounding_level && (
                      <Badge variant="secondary">{vector.grounding_level}</Badge>
                    )}
                    <Badge variant={item.status === "included" ? "secondary" : "outline"}>
                      {item.status}
                    </Badge>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  {item.rights_holder ?? "Rights holder not recorded"}
                  {licence?.license ? ` · ${licence.license}` : " · no licence on file"}
                  {licence?.attribution ? ` · credit: ${licence.attribution}` : ""}
                </p>

                {match && vector ? (
                  <div className="mt-2 rounded bg-muted/40 p-2">
                    <div className="flex flex-wrap items-baseline gap-2">
                      <span className="text-2xl font-semibold tabular-nums text-primary">
                        {match.score}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {resonanceWording(match.score)} · held back most by{" "}
                        <span className="capitalize">{match.weakestAxis}</span>
                      </span>
                    </div>
                    <div className="mt-1 grid grid-cols-2 gap-1 text-xs text-muted-foreground sm:grid-cols-3">
                      {RESONANCE_AXES.map((axis) => (
                        <span key={axis} className="capitalize">
                          {axis}:{" "}
                          <span className="text-foreground">{Math.round(vector[axis] ?? 0)}</span> (
                          {match.gaps[axis] > 0 ? "+" : ""}
                          {match.gaps[axis]})
                        </span>
                      ))}
                    </div>
                  </div>
                ) : (
                  <p className="mt-2 text-xs text-muted-foreground">
                    No scores from audio yet for this work, so it can't be matched to an audience.
                  </p>
                )}

                {inclusions > 0 && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    {inclusions} inclusion{inclusions === 1 ? "" : "s"} · ${paid.toFixed(2)} recorded
                  </p>
                )}

                <div className="mt-2 flex flex-wrap gap-2">
                  {item.status !== "included" && licence?.license && (
                    <Button size="sm" variant="outline" onClick={() => setStatus(item.id, "included")}>
                      Include
                    </Button>
                  )}
                  {item.status === "included" && (
                    <>
                      <Button size="sm" variant="outline" onClick={() => recordInclusion(item.id)}>
                        Record an inclusion
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setStatus(item.id, "withdrawn")}>
                        Withdraw
                      </Button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
