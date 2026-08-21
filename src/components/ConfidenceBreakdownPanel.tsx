import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
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
  GitCompare,
  X,
} from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";


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


/* --------------------------------------------------------------- helpers */

type DriverRow = SummaryRow & { feed: string; object_key?: string | null };

const computeDriverRows = (identifier: Record<string, unknown> | null): DriverRow[] => {
  if (!identifier) return [];
  const out: DriverRow[] = [];
  for (const [col, label] of SIGNAL_COLUMNS) {
    const block = (identifier[col] ?? null) as SignalBlock | null;
    if (!block?.rows?.length) continue;
    for (const r of block.rows) out.push({ ...r, feed: label, object_key: block.object_key });
  }
  return out.sort((a, b) => (Number(b.uniques) || 0) - (Number(a.uniques) || 0));
};

const computeMath = (analysis: Record<string, number | string | null> | null) => {
  if (!analysis) return null;
  const scores = SCORE_KEYS.map(([k]) => Number(analysis[k]) || 0);
  const mean = scores.reduce((s, v) => s + v, 0) / scores.length;
  const stddev = Math.sqrt(scores.reduce((s, v) => s + (v - mean) ** 2, 0) / scores.length);
  const spread = Math.max(0.1, Math.min(1, stddev / 30));
  const confidence = Number(analysis.confidence) || 0;
  const factor = spread > 0 ? confidence / spread : 0;
  const tier = EVIDENCE_TIERS.reduce(
    (best, t) => (Math.abs(t.factor - factor) < Math.abs(best.factor - factor) ? t : best),
    EVIDENCE_TIERS[0],
  );
  return { scores, mean, stddev, spread, confidence, factor, tier };
};

interface Bundle {
  id: string;
  identifier: Record<string, unknown> | null;
  analysis: Record<string, number | string | null> | null;
  tags: TagRow[];
}

const fetchBundle = async (id: string): Promise<{ bundle: Bundle | null; error?: string }> => {
  const { data, error } = await supabase
    .from("intuizi_identifiers")
    .select(
      "primary_identifier, ctv_signals, apps_signals, visitation_signals, demographics_signals, origin_signals, tag_codes, audio_source_id, observation_count, updated_at",
    )
    .eq("primary_identifier", `activation:${id.trim()}`)
    .maybeSingle();

  if (error) return { bundle: null, error: error.message };
  if (!data) return { bundle: null };

  const identifier = data as unknown as Record<string, unknown>;
  const sourceId = (data as { audio_source_id: string | null }).audio_source_id;
  if (!sourceId) return { bundle: { id, identifier, analysis: null, tags: [] } };

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

  return {
    bundle: {
      id,
      identifier,
      analysis: (anaRes.data ?? null) as unknown as Record<string, number | string | null> | null,
      tags: (tagRes.data ?? []) as unknown as TagRow[],
    },
  };
};

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
            <p className="text-[11px] text-muted-foreground">
              Select a row to drill into the source record, the fields that contributed, and the
              linked audience identifiers.
            </p>
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
                    {driverRows.map((r, i) => {
                      const isOpen = openRow === i;
                      const d = drill[i];
                      const rawEntries = Object.entries(r).filter(
                        ([k]) => k !== "feed" && k !== "object_key",
                      );
                      return (
                        <Fragment key={i}>
                          <tr
                            className="cursor-pointer border-b border-border/50 transition-smooth hover:bg-muted/40"
                            onClick={() => loadDrill(i, r)}
                          >
                            <td className="py-1.5 pr-3">
                              <span className="flex items-center gap-1">
                                {drillLoading === i ? (
                                  <Loader2 className="h-3 w-3 animate-spin" />
                                ) : isOpen ? (
                                  <ChevronDown className="h-3 w-3 text-primary" />
                                ) : (
                                  <ChevronRight className="h-3 w-3 text-muted-foreground" />
                                )}
                                <Badge variant="outline" className="text-[10px]">
                                  {r.feed}
                                </Badge>
                              </span>
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
                          {isOpen && (
                            <tr className="border-b border-border/50">
                              <td colSpan={6} className="p-0">
                                <div className="space-y-3 bg-muted/20 px-3 py-3">
                                  {/* source file */}
                                  <div className="rounded-md border border-border bg-card/60 p-3">
                                    <div className="flex items-center gap-1.5 text-[11px] font-medium">
                                      <FileText className="h-3.5 w-3.5 text-primary" />
                                      Source record
                                    </div>
                                    <p className="mt-1 break-all font-mono text-[10px] text-muted-foreground">
                                      {r.object_key ?? "object key not recorded on this signal block"}
                                    </p>
                                    {d?.file ? (
                                      <div className="mt-2 grid gap-2 sm:grid-cols-3">
                                        {(
                                          [
                                            ["report type", d.file.report_type],
                                            ["status", d.file.status],
                                            ["partition", d.file.partition_date ?? "—"],
                                            ["size", fmtBytes(d.file.size_bytes)],
                                            [
                                              "rows",
                                              `${d.file.processed_rows}/${d.file.total_rows} ok · ${d.file.failed_rows} failed`,
                                            ],
                                            [
                                              "finished",
                                              d.file.finished_at
                                                ? new Date(d.file.finished_at).toLocaleString()
                                                : "—",
                                            ],
                                          ] as const
                                        ).map(([k, v]) => (
                                          <div key={k}>
                                            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                                              {k}
                                            </p>
                                            <p className="text-[11px]">{v}</p>
                                          </div>
                                        ))}
                                        {d.file.error_message && (
                                          <p className="sm:col-span-3 text-[11px] text-destructive">
                                            {d.file.error_message}
                                          </p>
                                        )}
                                      </div>
                                    ) : (
                                      <p className="mt-2 text-[11px] text-muted-foreground">
                                        No ingest-ledger entry found for this object key.
                                      </p>
                                    )}
                                  </div>

                                  {/* raw fields */}
                                  <div className="rounded-md border border-border bg-card/60 p-3">
                                    <p className="text-[11px] font-medium">
                                      Fields that contributed
                                    </p>
                                    <div className="mt-2 grid gap-x-4 gap-y-1 sm:grid-cols-2">
                                      {rawEntries.map(([k, v]) => (
                                        <div
                                          key={k}
                                          className="flex items-baseline justify-between gap-3 border-b border-border/40 py-0.5"
                                        >
                                          <span className="font-mono text-[10px] text-muted-foreground">
                                            {k}
                                          </span>
                                          <span className="break-all text-right text-[11px]">
                                            {v === null || v === undefined || v === ""
                                              ? "—"
                                              : String(v)}
                                          </span>
                                        </div>
                                      ))}
                                    </div>
                                  </div>

                                  {/* mapped nodes */}
                                  <div className="rounded-md border border-border bg-card/60 p-3">
                                    <p className="text-[11px] font-medium">
                                      Ontology nodes this row resolved to
                                    </p>
                                    {d && d.matchedTags.length > 0 ? (
                                      <div className="mt-2 space-y-2">
                                        {d.matchedTags.map((t, ti) => (
                                          <div key={ti} className="flex items-center gap-3">
                                            <span className="w-56 shrink-0 truncate text-[11px]">
                                              {t.taxonomy_nodes?.label ?? "unknown node"}
                                            </span>
                                            <Progress
                                              value={Math.min(100, Number(t.weight) * 100)}
                                              className="h-1.5"
                                            />
                                            <span className="w-20 shrink-0 text-right font-mono text-[10px] text-muted-foreground">
                                              w {Number(t.weight).toFixed(2)}
                                            </span>
                                          </div>
                                        ))}
                                        <div className="flex flex-wrap gap-1">
                                          {(d.matchedCodes.length
                                            ? d.matchedCodes
                                            : d.matchedTags.map((t) => t.taxonomy_nodes?.code ?? "")
                                          )
                                            .filter(Boolean)
                                            .map((c) => (
                                              <Badge
                                                key={c}
                                                variant="secondary"
                                                className="font-mono text-[10px]"
                                              >
                                                {c}
                                              </Badge>
                                            ))}
                                        </div>
                                        <p className="text-[10px] text-muted-foreground">
                                          contribution ≈ share{" "}
                                          {r.share != null ? Number(r.share).toFixed(2) : "—"} × node
                                          weight — this row carries{" "}
                                          {r.share != null
                                            ? `${(Number(r.share) * 100).toFixed(0)}%`
                                            : "an unknown share"}{" "}
                                          of the profile's tagged evidence.
                                        </p>
                                      </div>
                                    ) : (
                                      <p className="mt-2 text-[11px] text-muted-foreground">
                                        No taxonomy node matched this row's category label.
                                      </p>
                                    )}
                                  </div>

                                  {/* roster */}
                                  <div className="rounded-md border border-border bg-card/60 p-3">
                                    <div className="flex items-center gap-1.5 text-[11px] font-medium">
                                      <Users className="h-3.5 w-3.5 text-primary" />
                                      Linked audience records ({d?.rosterCount ?? 0})
                                    </div>
                                    {d && d.roster.length > 0 ? (
                                      <div className="mt-2 space-y-1">
                                        {d.roster.map((ro) => (
                                          <div
                                            key={ro.primary_identifier}
                                            className="flex items-center justify-between gap-3 border-b border-border/40 py-0.5"
                                          >
                                            <span className="break-all font-mono text-[10px]">
                                              {ro.primary_identifier}
                                            </span>
                                            <span className="shrink-0 text-[10px] text-muted-foreground">
                                              {ro.observation_count} obs
                                              {ro.last_seen_at
                                                ? ` · ${new Date(ro.last_seen_at).toLocaleDateString()}`
                                                : ""}
                                            </span>
                                          </div>
                                        ))}
                                        {d.rosterCount > d.roster.length && (
                                          <p className="text-[10px] text-muted-foreground">
                                            showing {d.roster.length} of {d.rosterCount} roster rows
                                          </p>
                                        )}
                                      </div>
                                    ) : (
                                      <p className="mt-2 text-[11px] text-muted-foreground">
                                        No roster identifiers are linked to this profile yet.
                                      </p>
                                    )}
                                  </div>
                                </div>
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}

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

          {/* comparison mode */}
          {(compareLoading || compare) && (
            <div className="mt-6 rounded-lg border border-primary/30 bg-primary/5 p-4">
              <div className="flex items-center gap-2">
                <GitCompare className="h-4 w-4 text-primary" />
                <h3 className="text-sm font-semibold">
                  Comparison — activation {activation.trim()} vs {compareId}
                </h3>
                {compareLoading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
              </div>

              {compare && (
                <>
                  {/* confidence math side by side */}
                  <div className="mt-3 overflow-x-auto">
                    <table className="w-full min-w-[520px] text-xs">
                      <thead>
                        <tr className="border-b border-border text-left text-muted-foreground">
                          <th className="py-1.5 pr-3 font-medium">Confidence input</th>
                          <th className="py-1.5 pr-3 font-medium">{activation.trim()}</th>
                          <th className="py-1.5 pr-3 font-medium">{compareId}</th>
                          <th className="py-1.5 font-medium">Delta</th>
                        </tr>
                      </thead>
                      <tbody className="font-mono">
                        {[
                          ["score stddev", math?.stddev, compareMath?.stddev, 1],
                          ["spread factor", math?.spread, compareMath?.spread, 3],
                          ["evidence factor", math?.tier.factor, compareMath?.tier.factor, 1],
                          ["confidence", math?.confidence, compareMath?.confidence, 3],
                        ].map(([label, a, b, dp]) => {
                          const av = typeof a === "number" ? a : null;
                          const bv = typeof b === "number" ? b : null;
                          const d = av !== null && bv !== null ? bv - av : null;
                          const fixed = dp as number;
                          return (
                            <tr key={String(label)} className="border-b border-border/50">
                              <td className="py-1.5 pr-3 font-sans">{String(label)}</td>
                              <td className="py-1.5 pr-3">{av !== null ? av.toFixed(fixed) : "—"}</td>
                              <td className="py-1.5 pr-3">{bv !== null ? bv.toFixed(fixed) : "—"}</td>
                              <td
                                className={
                                  "py-1.5 " +
                                  (d === null
                                    ? "text-muted-foreground"
                                    : d > 0
                                      ? "text-primary"
                                      : d < 0
                                        ? "text-destructive"
                                        : "text-muted-foreground")
                                }
                              >
                                {d === null ? "—" : `${d > 0 ? "+" : ""}${d.toFixed(fixed)}`}
                              </td>
                            </tr>
                          );
                        })}
                        <tr>
                          <td className="py-1.5 pr-3 font-sans">evidence tier</td>
                          <td className="py-1.5 pr-3 font-sans capitalize">{math?.tier.kind ?? "—"}</td>
                          <td className="py-1.5 pr-3 font-sans capitalize">{compareMath?.tier.kind ?? "—"}</td>
                          <td className="py-1.5 font-sans text-muted-foreground">
                            {math && compareMath && math.tier.kind !== compareMath.tier.kind
                              ? "different evidence path"
                              : "same"}
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>

                  {/* driver rows side by side */}
                  <div className="mt-4 grid gap-4 lg:grid-cols-2">
                    {[
                      { id: activation.trim(), rows: driverRows, cat: analysis?.category, nodes: tags.length },
                      { id: compareId, rows: compareDriverRows, cat: compare.analysis?.category, nodes: compare.tags.length },
                    ].map((side) => (
                      <div key={side.id} className="rounded-md border border-border bg-card/60 p-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-xs font-semibold">Activation {side.id}</p>
                          {side.cat ? (
                            <Badge variant="secondary">{String(side.cat)}</Badge>
                          ) : (
                            <span className="text-[11px] text-muted-foreground">not scored</span>
                          )}
                          <span className="ml-auto text-[11px] text-muted-foreground">
                            {side.rows.length} driver row{side.rows.length === 1 ? "" : "s"} · {side.nodes} node
                            {side.nodes === 1 ? "" : "s"}
                          </span>
                        </div>
                        <table className="mt-2 w-full text-[11px]">
                          <thead>
                            <tr className="border-b border-border text-left text-muted-foreground">
                              <th className="py-1 pr-2 font-medium">Feed</th>
                              <th className="py-1 pr-2 font-medium">Category</th>
                              <th className="py-1 pr-2 font-medium">Share</th>
                              <th className="py-1 font-medium">Uniques</th>
                            </tr>
                          </thead>
                          <tbody>
                            {side.rows.length === 0 && (
                              <tr>
                                <td colSpan={4} className="py-2 text-muted-foreground">
                                  No driver rows ingested.
                                </td>
                              </tr>
                            )}
                            {side.rows.slice(0, 10).map((r, i) => (
                              <tr key={i} className="border-b border-border/50">
                                <td className="py-1 pr-2 text-muted-foreground">{r.feed}</td>
                                <td className="py-1 pr-2">{r.TaxonomyName || r.CategoryName || "—"}</td>
                                <td className="py-1 pr-2 font-mono">
                                  {r.share != null ? `${(Number(r.share) * 100).toFixed(0)}%` : "—"}
                                </td>
                                <td className="py-1 font-mono">{Number(r.uniques) || 0}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ))}
                  </div>

                  {/* per-category deltas */}
                  <div className="mt-4 grid gap-2 sm:grid-cols-3">
                    {SCORE_KEYS.map(([k, label]) => {
                      const a = Number(analysis?.[k]) || 0;
                      const b = Number(compare.analysis?.[k]) || 0;
                      const d = b - a;
                      return (
                        <div key={k} className="rounded-md border border-border bg-card/60 px-3 py-2">
                          <p className="text-[11px] text-muted-foreground">{label}</p>
                          <p className="text-sm font-semibold">
                            {Math.round(a)} → {Math.round(b)}{" "}
                            <span
                              className={
                                "text-[11px] font-mono " +
                                (d > 0 ? "text-primary" : d < 0 ? "text-destructive" : "text-muted-foreground")
                              }
                            >
                              {d > 0 ? "+" : ""}
                              {Math.round(d)}
                            </span>
                          </p>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
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
