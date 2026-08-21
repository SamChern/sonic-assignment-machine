import { useCallback, useEffect, useMemo, useState } from "react";
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
  ChevronRight,
  ChevronDown,
  FileText,
  Users,
} from "lucide-react";


/* ------------------------------------------------------------------ types */

interface SummaryRow {
  CategoryName?: string | null;
  TaxonomyName?: string | null;
  uniques?: number | null;
  signals?: number | null;
  share?: number | null;
  period?: string | null;
  scope?: string | null;
  activation_id?: string | null;
}

interface SignalBlock {
  rows?: SummaryRow[];
  confidence?: number | null;
  scores?: Record<string, number> | null;
  object_key?: string | null;
  scored_at?: string | null;
}

interface TagRow {
  weight: number;
  taxonomy_nodes: { code: string; label: string; parent_code: string | null } | null;
}

interface IngestFileRow {
  object_key: string;
  report_type: string;
  status: string;
  partition_date: string | null;
  size_bytes: number | null;
  total_rows: number;
  processed_rows: number;
  failed_rows: number;
  error_message: string | null;
  discovered_at: string;
  finished_at: string | null;
}

interface RosterRow {
  primary_identifier: string;
  observation_count: number;
  last_seen_at: string | null;
  tag_codes: string[] | null;
}

interface DrillData {
  file: IngestFileRow | null;
  rosterCount: number;
  roster: RosterRow[];
  matchedTags: TagRow[];
  matchedCodes: string[];
}

const slugify = (v: string) =>
  v
    .toLowerCase()
    .replace(/&/g, " ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

const fmtBytes = (n: number | null) => {
  if (n == null) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
};


const SIGNAL_COLUMNS = [
  ["ctv_signals", "CTV"],
  ["apps_signals", "Apps"],
  ["visitation_signals", "Visitation"],
  ["demographics_signals", "Demographics"],
  ["origin_signals", "Origin"],
] as const;

const SCORE_KEYS = [
  ["emotional_score", "Emotional"],
  ["cognitive_score", "Cognitive"],
  ["social_score", "Social"],
  ["communication_score", "Communication"],
  ["contextual_score", "Contextual"],
  ["artistic_score", "Artistic"],
] as const;

const EVIDENCE_TIERS = [
  { factor: 1.0, kind: "librosa", detail: "full acoustic feature extraction" },
  { factor: 0.8, kind: "provider", detail: "provider metadata / preview audio" },
  { factor: 0.6, kind: "neighbors", detail: "nearest-neighbour profile inference" },
  { factor: 0.4, kind: "none", detail: "taxonomy metadata only — no audio was analysed" },
];

/* ------------------------------------------------------------------ panel */

const ConfidenceBreakdownPanel = ({ defaultActivation = "5498" }: { defaultActivation?: string }) => {
  const [activation, setActivation] = useState(defaultActivation);
  const [loading, setLoading] = useState(false);
  const [identifier, setIdentifier] = useState<Record<string, unknown> | null>(null);
  const [analysis, setAnalysis] = useState<Record<string, number | string | null> | null>(null);
  const [tags, setTags] = useState<TagRow[]>([]);
  const [notFound, setNotFound] = useState(false);

  const load = useCallback(async (id: string) => {
    setLoading(true);
    setNotFound(false);
    const { data, error } = await supabase
      .from("intuizi_identifiers")
      .select(
        "primary_identifier, ctv_signals, apps_signals, visitation_signals, demographics_signals, origin_signals, tag_codes, audio_source_id, observation_count, updated_at",
      )
      .eq("primary_identifier", `activation:${id.trim()}`)
      .maybeSingle();

    if (error) {
      toast({ title: "Could not load activation", description: error.message, variant: "destructive" });
      setLoading(false);
      return;
    }
    if (!data) {
      setIdentifier(null);
      setAnalysis(null);
      setTags([]);
      setNotFound(true);
      setLoading(false);
      return;
    }

    setIdentifier(data as unknown as Record<string, unknown>);
    const sourceId = (data as { audio_source_id: string | null }).audio_source_id;

    if (sourceId) {
      const [anaRes, tagRes] = await Promise.all([
        supabase
          .from("source_analyses")
          .select(
            "confidence, category, created_at, emotional_score, cognitive_score, social_score, communication_score, contextual_score, artistic_score",
          )
          .eq("audio_source_id", sourceId)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabase
          .from("audio_source_tags")
          .select("weight, taxonomy_nodes(code, label, parent_code)")
          .eq("audio_source_id", sourceId)
          .order("weight", { ascending: false }),
      ]);
      setAnalysis((anaRes.data ?? null) as unknown as Record<string, number | string | null> | null);
      setTags((tagRes.data ?? []) as unknown as TagRow[]);
    } else {
      setAnalysis(null);
      setTags([]);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load(defaultActivation);
  }, [defaultActivation, load]);

  /* ---------------------------------------------------------- derivations */

  const blocks = useMemo(() => {
    if (!identifier) return [] as { label: string; block: SignalBlock }[];
    return SIGNAL_COLUMNS.map(([col, label]) => ({
      label: label as string,
      block: (identifier[col] ?? null) as SignalBlock | null,
    }))
      .filter((b) => !!b.block && !!b.block.rows?.length)
      .map((b) => ({ label: b.label, block: b.block as SignalBlock }));

  }, [identifier]);

  const driverRows = useMemo(() => {
    const out: (SummaryRow & { feed: string; object_key?: string | null })[] = [];
    for (const { label, block } of blocks) {
      for (const r of block.rows ?? []) out.push({ ...r, feed: label, object_key: block.object_key });
    }
    return out.sort((a, b) => (Number(b.uniques) || 0) - (Number(a.uniques) || 0));
  }, [blocks]);

  const math = useMemo(() => {
    if (!analysis) return null;
    const scores = SCORE_KEYS.map(([k]) => Number(analysis[k]) || 0);
    const mean = scores.reduce((s, v) => s + v, 0) / scores.length;
    const stddev = Math.sqrt(scores.reduce((s, v) => s + (v - mean) ** 2, 0) / scores.length);
    const spread = Math.max(0.1, Math.min(1, stddev / 30));
    const confidence = Number(analysis.confidence) || 0;
    const factor = spread > 0 ? confidence / spread : 0;
    const tier =
      EVIDENCE_TIERS.reduce(
        (best, t) => (Math.abs(t.factor - factor) < Math.abs(best.factor - factor) ? t : best),
        EVIDENCE_TIERS[0],
      );
    return { scores, mean, stddev, spread, confidence, factor, tier };
  }, [analysis]);

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
        </div>
      </div>

      <p className="mt-2 text-xs text-muted-foreground">
        Which taxonomy rows drove the ontology score for an Intuizi activation, and exactly why the
        recorded confidence landed where it did.
      </p>

      {notFound && (
        <p className="mt-4 text-sm text-muted-foreground">
          No ingested profile found for activation {activation}. Run the post-ingestion wizard first.
        </p>
      )}

      {identifier && (
        <>
          {/* headline */}
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <div className="rounded-md border border-border p-3">
              <p className="text-xs text-muted-foreground">Recorded confidence</p>
              <p className="text-2xl font-semibold">
                {math ? math.confidence.toFixed(3) : "—"}
              </p>
              <Progress value={(math?.confidence ?? 0) * 100} className="mt-2 h-1.5" />
            </div>
            <div className="rounded-md border border-border p-3">
              <p className="text-xs text-muted-foreground">Dominant category</p>
              <p className="mt-1">
                {analysis?.category ? (
                  <Badge>{String(analysis.category)}</Badge>
                ) : (
                  <span className="text-sm text-muted-foreground">not scored</span>
                )}
              </p>
              <p className="mt-2 text-[11px] text-muted-foreground">
                {tags.length} taxonomy node{tags.length === 1 ? "" : "s"} ·{" "}
                {driverRows.length} driver row{driverRows.length === 1 ? "" : "s"}
              </p>
            </div>
            <div className="rounded-md border border-border p-3">
              <p className="text-xs text-muted-foreground">Evidence tier</p>
              <p className="text-lg font-semibold capitalize">{math?.tier.kind ?? "—"}</p>
              <p className="mt-1 text-[11px] text-muted-foreground">
                weight ×{math ? math.tier.factor.toFixed(1) : "—"} · {math?.tier.detail}
              </p>
            </div>
          </div>

          {/* math */}
          {math && (
            <div className="mt-4 rounded-md border border-border bg-muted/30 p-3">
              <p className="text-xs font-medium">How the number is computed</p>
              <p className="mt-1 font-mono text-[11px] leading-relaxed text-muted-foreground">
                scores = [{math.scores.map((s) => Math.round(s)).join(", ")}] · mean{" "}
                {math.mean.toFixed(1)} · stddev {math.stddev.toFixed(2)}
                <br />
                spread = clamp(stddev / 30, 0.1, 1) = {math.spread.toFixed(3)}
                <br />
                confidence = spread × evidence({math.tier.kind} = {math.tier.factor.toFixed(1)}) ={" "}
                {math.confidence.toFixed(3)}
              </p>
            </div>
          )}

          {/* driver rows */}
          <div className="mt-5">
            <p className="text-xs font-medium">Taxonomy rows that drove the score</p>
            {driverRows.length === 0 ? (
              <p className="mt-2 text-sm text-muted-foreground">
                No summary rows recorded for this activation.
              </p>
            ) : (
              <div className="mt-2 overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="text-muted-foreground">
                    <tr className="border-b border-border">
                      <th className="py-1.5 pr-3 font-medium">Feed</th>
                      <th className="py-1.5 pr-3 font-medium">Taxonomy / category</th>
                      <th className="py-1.5 pr-3 font-medium">Uniques</th>
                      <th className="py-1.5 pr-3 font-medium">Signals</th>
                      <th className="py-1.5 pr-3 font-medium">Share</th>
                      <th className="py-1.5 pr-3 font-medium">Period</th>
                    </tr>
                  </thead>
                  <tbody>
                    {driverRows.map((r, i) => (
                      <tr key={i} className="border-b border-border/50">
                        <td className="py-1.5 pr-3">
                          <Badge variant="outline" className="text-[10px]">
                            {r.feed}
                          </Badge>
                        </td>
                        <td className="py-1.5 pr-3">
                          {[r.TaxonomyName, r.CategoryName].filter(Boolean).join(" · ") || "—"}
                        </td>
                        <td className="py-1.5 pr-3">{r.uniques ?? "—"}</td>
                        <td className="py-1.5 pr-3">{r.signals ?? "—"}</td>
                        <td className="py-1.5 pr-3">
                          {r.share != null ? `${(Number(r.share) * 100).toFixed(0)}%` : "—"}
                        </td>
                        <td className="py-1.5 pr-3">{r.period ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* tag weights */}
          {tags.length > 0 && (
            <div className="mt-5">
              <p className="text-xs font-medium">Resolved ontology nodes and weights</p>
              <div className="mt-2 space-y-2">
                {tags.map((t, i) => (
                  <div key={i} className="flex items-center gap-3">
                    <span className="w-64 shrink-0 truncate text-xs">
                      {t.taxonomy_nodes?.label ?? "unknown node"}
                    </span>
                    <Progress value={Math.min(100, Number(t.weight) * 100)} className="h-1.5" />
                    <span className="w-12 shrink-0 text-right font-mono text-[11px] text-muted-foreground">
                      {Number(t.weight).toFixed(2)}
                    </span>
                  </div>
                ))}
              </div>
              <div className="mt-2 flex flex-wrap gap-1">
                {tags.map((t, i) => (
                  <Badge key={i} variant="secondary" className="font-mono text-[10px]">
                    {t.taxonomy_nodes?.code}
                  </Badge>
                ))}
              </div>
            </div>
          )}

          {/* per-category scores */}
          {analysis && (
            <div className="mt-5 grid gap-2 sm:grid-cols-3">
              {SCORE_KEYS.map(([k, label]) => (
                <div key={k} className="rounded-md border border-border px-3 py-2">
                  <p className="text-[11px] text-muted-foreground">{label}</p>
                  <p className="text-sm font-semibold">{Math.round(Number(analysis[k]) || 0)}</p>
                </div>
              ))}
            </div>
          )}

          {/* why low */}
          {reasons.length > 0 && (
            <div className="mt-5 rounded-md border border-destructive/30 bg-destructive/5 p-3">
              <div className="flex items-center gap-1.5 text-xs font-medium text-destructive">
                <AlertTriangle className="h-3.5 w-3.5" />
                Why confidence is low
              </div>
              <ul className="mt-2 space-y-1.5 text-xs text-muted-foreground">
                {reasons.map((r, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="text-destructive">•</span>
                    <span>{r}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="mt-4 rounded-md border border-border p-3">
            <div className="flex items-center gap-1.5 text-xs font-medium">
              <Info className="h-3.5 w-3.5 text-primary" />
              What would raise it
            </div>
            <ul className="mt-2 space-y-1.5 text-xs text-muted-foreground">
              {fixes.map((f) => (
                <li key={f} className="flex gap-2">
                  <span className="text-primary">•</span>
                  <span>{f}</span>
                </li>
              ))}
            </ul>
          </div>
        </>
      )}
    </Card>
  );
};

export default ConfidenceBreakdownPanel;
