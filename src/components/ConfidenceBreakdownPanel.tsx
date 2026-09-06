import { useCallback, useEffect, useMemo, useState } from "react";
import { useUiPreferenceValue } from "@/hooks/useUiPreference";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { toast } from "@/hooks/use-toast";
import {
  Gauge,
  Loader2,
  RefreshCw,
  AlertTriangle,
  Info,
  GitCompare,
  X,
  SlidersHorizontal,
} from "lucide-react";
import { Slider } from "@/components/ui/slider";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import DriverRowsTable from "@/components/confidence/DriverRowsTable";
import ComparisonSection from "@/components/confidence/ComparisonSection";
import {
  SCORE_KEYS,
  computeDriverRows,
  computeMath,
  fetchBundle,
  slugify,
  type Bundle,
  type DrillData,
  type DriverRow,
  type IngestFileRow,
  type RosterRow,
  type SummaryRow,
  type TagRow,
} from "@/lib/confidenceBreakdown";


/* ------------------------------------------------------------------ panel */

const ConfidenceBreakdownPanel = ({ defaultActivation = "5498" }: { defaultActivation?: string }) => {
  const [activation, setActivation] = useState(defaultActivation);
  const [loading, setLoading] = useState(false);
  const [identifier, setIdentifier] = useState<Record<string, unknown> | null>(null);
  const [analysis, setAnalysis] = useState<Record<string, number | string | null> | null>(null);
  const [tags, setTags] = useState<TagRow[]>([]);
  const [notFound, setNotFound] = useState(false);
  const [openRow, setOpenRow] = useState<number | null>(null);
  const [drill, setDrill] = useState<Record<number, DrillData>>({});
  const [drillLoading, setDrillLoading] = useState<number | null>(null);
  const [options, setOptions] = useState<string[]>([]);
  const [compareId, setCompareId] = useState<string>("");
  const [compare, setCompare] = useState<Bundle | null>(null);
  const [compareLoading, setCompareLoading] = useState(false);
  const [threshold, setThreshold] = useUiPreferenceValue<number>(
    "confidence.lowThreshold",
    0.15,
    (v) => typeof v === "number" && v > 0 && v <= 1,
  );


  const load = useCallback(async (id: string) => {
    setLoading(true);
    setNotFound(false);
    setOpenRow(null);
    setDrill({});
    const { bundle, error } = await fetchBundle(id);
    if (error) {
      toast({ title: "Could not load activation", description: error, variant: "destructive" });
      setLoading(false);
      return;
    }
    if (!bundle) {
      setIdentifier(null);
      setAnalysis(null);
      setTags([]);
      setNotFound(true);
      setLoading(false);
      return;
    }
    setIdentifier(bundle.identifier);
    setAnalysis(bundle.analysis);
    setTags(bundle.tags);
    setLoading(false);
  }, []);

  useEffect(() => {
    load(defaultActivation);
  }, [defaultActivation, load]);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("intuizi_identifiers")
        .select("primary_identifier")
        .like("primary_identifier", "activation:%")
        .order("updated_at", { ascending: false })
        .limit(100);
      const ids = Array.from(
        new Set(((data ?? []) as { primary_identifier: string }[]).map((r) => r.primary_identifier.replace("activation:", ""))),
      );
      setOptions(ids);
    })();
  }, []);

  const loadCompare = useCallback(async (id: string) => {
    setCompareId(id);
    if (!id) {
      setCompare(null);
      return;
    }
    setCompareLoading(true);
    const { bundle, error } = await fetchBundle(id);
    if (error) {
      toast({ title: "Could not load comparison", description: error, variant: "destructive" });
    } else if (!bundle) {
      toast({ title: `No ingested profile for activation ${id}`, variant: "destructive" });
    }
    setCompare(bundle);
    setCompareLoading(false);
  }, []);

  const compareDriverRows = useMemo(
    () => computeDriverRows(compare?.identifier ?? null),
    [compare],
  );
  const compareMath = useMemo(() => computeMath(compare?.analysis ?? null), [compare]);

  /* ---------------------------------------------------------- derivations */

  const driverRows = useMemo(() => computeDriverRows(identifier), [identifier]);

  const loadDrill = useCallback(
    async (index: number, row: SummaryRow & { feed: string; object_key?: string | null }) => {
      if (openRow === index) {
        setOpenRow(null);
        return;
      }
      setOpenRow(index);
      if (drill[index]) return;

      setDrillLoading(index);
      const sourceId = (identifier as { audio_source_id?: string | null } | null)?.audio_source_id ?? null;

      const [fileRes, rosterRes] = await Promise.all([
        row.object_key
          ? supabase
              .from("intuizi_ingest_files")
              .select(
                "object_key, report_type, status, partition_date, size_bytes, total_rows, processed_rows, failed_rows, error_message, discovered_at, finished_at",
              )
              .eq("object_key", row.object_key)
              .maybeSingle()
          : Promise.resolve({ data: null }),
        sourceId
          ? supabase
              .from("intuizi_identifiers")
              .select("primary_identifier, observation_count, last_seen_at, tag_codes", {
                count: "exact",
              })
              .eq("audio_source_id", sourceId)
              .neq("primary_identifier", `activation:${activation.trim()}`)
              .order("updated_at", { ascending: false })
              .limit(8)
          : Promise.resolve({ data: [], count: 0 }),
      ]);

      const slugs = [row.TaxonomyName, row.CategoryName]
        .filter((v): v is string => !!v && !!v.trim())
        .map(slugify);
      const matchedTags = tags.filter((t) => {
        const code = (t.taxonomy_nodes?.code ?? "").toLowerCase();
        const label = (t.taxonomy_nodes?.label ?? "").toLowerCase();
        return slugs.some((sl) => code.endsWith(sl) || code.includes(sl) || slugify(label) === sl);
      });
      const codes = ((identifier as { tag_codes?: string[] | null } | null)?.tag_codes ?? []).filter(
        (c) => slugs.some((sl) => c.toLowerCase().includes(sl)),
      );

      setDrill((prev) => ({
        ...prev,
        [index]: {
          file: ((fileRes as { data: unknown }).data ?? null) as IngestFileRow | null,
          rosterCount:
            (rosterRes as { count?: number | null }).count ??
            ((rosterRes as { data?: unknown[] }).data?.length ?? 0),
          roster: (((rosterRes as { data?: unknown[] }).data ?? []) as unknown) as RosterRow[],
          matchedTags: matchedTags.length ? matchedTags : tags,
          matchedCodes: codes,
        },
      }));
      setDrillLoading(null);
    },
    [openRow, drill, identifier, tags, activation],
  );

  const math = useMemo(() => computeMath(analysis), [analysis]);

  /** Per-row support = row share x evidence factor. Rows below the threshold are flagged. */
  const rowSupport = useCallback(
    (share: unknown, factor?: number) => (Number(share) || 0) * (factor ?? math?.tier.factor ?? 0),
    [math],
  );
  const flaggedCount = useMemo(
    () => driverRows.filter((r) => rowSupport(r.share) < threshold).length,
    [driverRows, rowSupport, threshold],
  );

  /* -------------------------------------------------- fastest-moving deltas */

  const rowKey = (r: SummaryRow) =>
    String(r.TaxonomyName || r.CategoryName || "—").trim().toLowerCase();

  /** Driver rows ranked by |support delta| between the two activations. */
  const rowMovers = useMemo(() => {
    if (!compare) return { ranked: [] as { key: string; label: string; a: number; b: number; delta: number }[], top: new Map<string, number>() };
    const fa = math?.tier.factor ?? 0;
    const fb = compareMath?.tier.factor ?? 0;
    const acc = new Map<string, { label: string; a: number; b: number }>();
    for (const r of driverRows) {
      const k = rowKey(r);
      const e = acc.get(k) ?? { label: String(r.TaxonomyName || r.CategoryName || "—"), a: 0, b: 0 };
      e.a += (Number(r.share) || 0) * fa;
      acc.set(k, e);
    }
    for (const r of compareDriverRows) {
      const k = rowKey(r);
      const e = acc.get(k) ?? { label: String(r.TaxonomyName || r.CategoryName || "—"), a: 0, b: 0 };
      e.b += (Number(r.share) || 0) * fb;
      acc.set(k, e);
    }
    const ranked = Array.from(acc.entries())
      .map(([key, v]) => ({ key, label: v.label, a: v.a, b: v.b, delta: v.b - v.a }))
      .filter((v) => Math.abs(v.delta) > 0.0001)
      .sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta));
    const top = new Map<string, number>();
    ranked.slice(0, 3).forEach((v, i) => top.set(v.key, i + 1));
    return { ranked, top };
  }, [compare, compareDriverRows, driverRows, math, compareMath]);

  /** Category scores ranked by |delta|; top 2 get highlighted. */
  const scoreMovers = useMemo(() => {
    if (!compare) return { ranked: [] as { k: string; label: string; a: number; b: number; delta: number }[], top: new Map<string, number>() };
    const ranked = SCORE_KEYS.map(([k, label]) => {
      const a = Number(analysis?.[k]) || 0;
      const b = Number(compare.analysis?.[k]) || 0;
      return { k: String(k), label: String(label), a, b, delta: b - a };
    })
      .filter((v) => Math.abs(v.delta) >= 1)
      .sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta));
    const top = new Map<string, number>();
    ranked.slice(0, 2).forEach((v, i) => top.set(v.k, i + 1));
    return { ranked, top };
  }, [compare, analysis]);


  const reasons = useMemo(() => {
    const list: string[] = [];
    if (!math) return list;
    if (math.tier.factor <= 0.4) {
      list.push(
        `Evidence tier "${math.tier.kind}" (×${math.tier.factor.toFixed(1)}): ${math.tier.detail}. This is the single biggest drag — it caps confidence at 40% of the score-spread value.`,
      );
    }
    if (math.stddev < 12) {
      list.push(
        `Flat score profile: the six category scores have a standard deviation of only ${math.stddev.toFixed(1)} points (spread factor ${math.spread.toFixed(3)}). The model had no decisive signal to separate one category from the rest.`,
      );
    }
    if (driverRows.length <= 2) {
      list.push(
        `Thin taxonomy input: only ${driverRows.length} summary row${driverRows.length === 1 ? "" : "s"} drove the score, so there is no cross-category contrast to learn from.`,
      );
    }
    const dominant = driverRows[0];
    if (dominant && Number(dominant.share) >= 0.95) {
      list.push(
        `Single-category audience: "${dominant.TaxonomyName || dominant.CategoryName}" holds ${(Number(dominant.share) * 100).toFixed(0)}% of unique devices, producing one tag at weight 1.00 and no differentiating structure.`,
      );
    }
    if (tags.length <= 1) {
      list.push(
        `Only ${tags.length} taxonomy node was attached to this profile; scoring quality rises steeply with 3+ nodes across different parents.`,
      );
    }
    return list;
  }, [math, driverRows, tags]);

  const fixes = [
    "Request per-device CTV rows (contentgenre / contenttype / channelname) for this activation — CTV feeds for id5497 arrived header-only.",
    "Include the app taxonomy level (TaxonomyName) alongside CategoryName so a second parent branch is tagged.",
    "Deliver multiple category rows per activation instead of a single rollup so device shares create contrast.",
    "Attach a representative audio asset (or preview URL) so the librosa path lifts the evidence factor from 0.4 to 1.0.",
  ];

  /* --------------------------------------------------------------- render */

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-center gap-2">
        <Gauge className="h-5 w-5 text-primary" />
        <h2 className="text-sm font-semibold">Confidence breakdown</h2>
        <div className="ml-auto flex items-center gap-2">
          <Input
            value={activation}
            onChange={(e) => setActivation(e.target.value)}
            className="h-8 w-28"
            placeholder="Activation id"
          />
          <Button size="sm" variant="outline" onClick={() => load(activation)} disabled={loading}>
            {loading ? (
              <Loader2 className="mr-1 h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="mr-1 h-4 w-4" />
            )}
            Analyze
          </Button>
          <div className="flex items-center gap-1">
            <GitCompare className="h-4 w-4 text-muted-foreground" />
            <Select value={compareId || "none"} onValueChange={(v) => loadCompare(v === "none" ? "" : v)}>
              <SelectTrigger className="h-8 w-[190px] text-xs">
                <SelectValue placeholder="Compare with..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Compare with...</SelectItem>
                {options
                  .filter((o) => o !== activation.trim())
                  .map((o) => (
                    <SelectItem key={o} value={o}>
                      Activation {o}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
            {compareId && (
              <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => loadCompare("")}>
                <X className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
      </div>

      <p className="mt-2 text-xs text-muted-foreground">
        Which taxonomy rows drove the ontology score for an Intuizi activation, and exactly why the
        recorded confidence landed where it did.
      </p>

      {notFound && (
        <p className="mt-4 text-sm text-muted-foreground">
          No ingested profile found for activation {activation}. Run the data stream wizard first.
        </p>
      )}

      {identifier && (
        <>
          <ConfidenceHeadline
            analysis={analysis}
            math={math}
            tags={tags}
            driverRows={driverRows}
            threshold={threshold}
            setThreshold={setThreshold}
            flaggedCount={flaggedCount}
          />

          <DriverRowsTable
            driverRows={driverRows}
            openRow={openRow}
            drill={drill}
            drillLoading={drillLoading}
            rowSupport={rowSupport}
            threshold={threshold}
            onRowClick={loadDrill}
          />

          <NodeWeightsAndScores tags={tags} analysis={analysis} />

          <WhyLowList reasons={reasons} />

          <ComparisonSection
            activation={activation}
            compareId={compareId}
            compareLoading={compareLoading}
            compare={compare}
            math={math}
            compareMath={compareMath}
            analysis={analysis}
            tags={tags}
            driverRows={driverRows}
            compareDriverRows={compareDriverRows}
            rowMovers={rowMovers}
            scoreMovers={scoreMovers}
            rowSupport={rowSupport}
            threshold={threshold}
            rowKey={rowKey}
          />

          <WhatWouldRaiseIt fixes={fixes} />
        </>
      )}
    </Card>
  );
};

export default ConfidenceBreakdownPanel;
