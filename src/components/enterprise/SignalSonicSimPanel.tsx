/**
 * SonicSIM analysis built from the feed's own enrichment signals.
 *
 * Each channel, genre, topic or group in a granted feed becomes a subject you
 * can play in the audioscope and compare in the table: the six scores are the
 * average of the devices behind it, and "with audio" says how many of those
 * devices carry real audio evidence rather than tag-only scoring.
 */
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, RefreshCw, Activity } from "lucide-react";
import SonicSimPanel, { type SonicSimSubject } from "@/components/visuals/SonicSimPanel";
import { AUDIOSCOPE_CATEGORIES } from "@/lib/audioscope/types";
import type { CategoryScores } from "@/lib/audioscope/types";
import { useSignalSonicSim, type SignalScoreRow } from "@/hooks/useSignalSonicSim";

const fmt = (n: number) => n.toLocaleString();
const SHORT: Record<string, string> = {
  emotional: "Emo",
  cognitive: "Cog",
  social: "Soc",
  communication: "Com",
  contextual: "Con",
  artistic: "Art",
};

const toScores = (row: SignalScoreRow): CategoryScores => {
  const out = {} as CategoryScores;
  for (const c of AUDIOSCOPE_CATEGORIES) out[c] = Number(row.scores?.[c] ?? 0);
  return out;
};

export default function SignalSonicSimPanel({ organizationId }: { organizationId: string }) {
  const [feeds, setFeeds] = useState<{ activation_id: string; label: string | null }[]>([]);
  const [feed, setFeed] = useState("");

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { data } = await supabase
        .from("org_intuizi_activations")
        .select("activation_id, label")
        .eq("organization_id", organizationId)
        .eq("is_active", true)
        .order("activation_id");
      if (cancelled) return;
      const rows = (data ?? []) as { activation_id: string; label: string | null }[];
      setFeeds(rows);
      setFeed((prev) => prev || rows[0]?.activation_id || "");
    })();
    return () => {
      cancelled = true;
    };
  }, [organizationId]);

  const { data, family, setFamily, loading, error, reload } = useSignalSonicSim(
    organizationId,
    feed,
  );

  const subjects = useMemo<SonicSimSubject[]>(
    () =>
      (data?.values ?? []).map((r) => ({
        id: `${r.family}:${r.value}`,
        label: r.value,
        sublabel: `${r.family} · ${fmt(r.devices)} devices${
          r.audio_devices > 0 ? ` · ${fmt(r.audio_devices)} with audio` : ""
        }`,
        scores: toScores(r),
      })),
    [data],
  );

  if (feeds.length === 0) {
    return null;
  }

  return (
    <Card className="p-4 sm:p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-primary" />
          <h3 className="text-base font-semibold">Performance by signal</h3>
          {data && (
            <Badge variant="secondary">
              {fmt(data.scored_devices)} of {fmt(data.sampled_devices)} sampled devices scored
            </Badge>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {feeds.length > 1 && (
            <Select value={feed} onValueChange={setFeed}>
              <SelectTrigger className="h-8 w-[190px]">
                <SelectValue placeholder="Choose a feed" />
              </SelectTrigger>
              <SelectContent>
                {feeds.map((f) => (
                  <SelectItem key={f.activation_id} value={f.activation_id}>
                    {f.label ?? `Feed ${f.activation_id}`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Button variant="outline" size="sm" onClick={() => void reload()} disabled={loading}>
            {loading ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="mr-2 h-4 w-4" />
            )}
            Refresh
          </Button>
        </div>
      </div>

      <p className="mb-3 text-sm text-muted-foreground">
        The six scores for each channel, genre or group are the average of the devices behind it in
        this feed. Groups with fewer than three scored devices are left out.
      </p>

      {data && data.families.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-1.5">
          {data.families.slice(0, 10).map((f) => (
            <button
              key={f.family}
              type="button"
              onClick={() => setFamily(f.family)}
              className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
                family === f.family
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border text-muted-foreground hover:bg-muted"
              }`}
            >
              {f.family} · {fmt(f.devices)}
            </button>
          ))}
        </div>
      )}

      {error && <p className="mb-3 text-sm text-destructive">{error}</p>}
      {loading && !data && <Skeleton className="h-72 w-full rounded-xl" />}

      {data && subjects.length === 0 && !loading && (
        <p className="text-sm text-muted-foreground">
          No group in this sample has three or more scored devices yet. Scoring runs in the
          background — check back once more rows are enriched.
        </p>
      )}

      {subjects.length > 0 && (
        <div className="space-y-4">
          <SonicSimPanel
            key={`${feed}-${family ?? "all"}`}
            lens="enterprise"
            subjects={subjects}
            title="Audioscope by signal"
            description="Play any channel, genre or group as its own sonic fingerprint, built from the devices behind it."
          />

          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="text-xs text-muted-foreground">
                <tr className="border-b">
                  <th className="py-1.5 pr-2 text-left font-medium">Signal</th>
                  <th className="py-1.5 pr-2 text-right font-medium">Devices</th>
                  <th className="py-1.5 pr-2 text-right font-medium">With audio</th>
                  <th className="py-1.5 pr-2 text-right font-medium">Confidence</th>
                  {AUDIOSCOPE_CATEGORIES.map((c) => (
                    <th key={c} className="py-1.5 pr-2 text-right font-medium">
                      {SHORT[c] ?? c}
                    </th>
                  ))}
                  <th className="py-1.5 pl-2 text-left font-medium">Strongest</th>
                </tr>
              </thead>
              <tbody>
                {data?.values.map((r) => {
                  const s = toScores(r);
                  return (
                    <tr key={`${r.family}:${r.value}`} className="border-b last:border-0">
                      <td className="py-1.5 pr-2">{r.value}</td>
                      <td className="py-1.5 pr-2 text-right">{fmt(r.devices)}</td>
                      <td className="py-1.5 pr-2 text-right">{fmt(r.audio_devices)}</td>
                      <td className="py-1.5 pr-2 text-right">
                        {r.avg_confidence == null
                          ? "—"
                          : `${Math.round(Number(r.avg_confidence) * 100)}%`}
                      </td>
                      {AUDIOSCOPE_CATEGORIES.map((c) => (
                        <td key={c} className="py-1.5 pr-2 text-right tabular-nums">
                          {Math.round(s[c])}
                        </td>
                      ))}
                      <td className="py-1.5 pl-2 capitalize">
                        {r.lead_category ?? "—"}
                        {r.lead_score != null && (
                          <span className="text-muted-foreground">
                            {" "}
                            · {Math.round(Number(r.lead_score))}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {data && (
        <p className="mt-3 text-xs text-muted-foreground">
          Updated {new Date(data.computed_at).toLocaleString()} · sample of{" "}
          {fmt(data.sample_size)} feed rows
        </p>
      )}
    </Card>
  );
}
