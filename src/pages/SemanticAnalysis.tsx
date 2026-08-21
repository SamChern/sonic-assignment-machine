import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { toast } from "@/hooks/use-toast";
import {
  ArrowLeft,
  RefreshCw,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  CircleDashed,
  Layers,
} from "lucide-react";

type StepState = "ok" | "pending" | "error";

interface IdentifierRow {
  id: string;
  primary_identifier: string;
  ctv_signals: Record<string, unknown> | null;
  apps_signals: Record<string, unknown> | null;
  visitation_signals: Record<string, unknown> | null;
  demographics_signals: Record<string, unknown> | null;
  origin_signals: Record<string, unknown> | null;
  tag_codes: string[] | null;
  audio_source_id: string | null;
  observation_count: number;
  last_seen_at: string | null;
  updated_at: string;
}

interface SourceRow {
  id: string;
  name: string;
  analysis_status: string;
  analysis_error: string | null;
  profile_embedding: unknown | null;
}

interface AnalysisRow {
  audio_source_id: string | null;
  category: string | null;
  confidence: number | null;
  created_at: string;
  emotional_score: number;
  cognitive_score: number;
  social_score: number;
  communication_score: number;
  contextual_score: number;
  artistic_score: number;
}

const CATEGORY_KEYS = [
  ["emotional_score", "Emo"],
  ["cognitive_score", "Cog"],
  ["social_score", "Soc"],
  ["communication_score", "Com"],
  ["contextual_score", "Ctx"],
  ["artistic_score", "Art"],
] as const;

const relative = (iso: string | null) => {
  if (!iso) return "never";
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 48) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
};

const nonEmpty = (o: Record<string, unknown> | null | undefined) =>
  !!o && Object.keys(o).length > 0;

const StepPill = ({
  label,
  state,
  detail,
}: {
  label: string;
  state: StepState;
  detail: string;
}) => {
  const Icon =
    state === "ok" ? CheckCircle2 : state === "error" ? AlertTriangle : CircleDashed;
  const tone =
    state === "ok"
      ? "text-primary border-primary/40 bg-primary/10"
      : state === "error"
        ? "text-destructive border-destructive/40 bg-destructive/10"
        : "text-muted-foreground border-border bg-muted/40";
  return (
    <div className={`rounded-md border px-3 py-2 ${tone}`}>
      <div className="flex items-center gap-1.5 text-xs font-medium">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </div>
      <p className="mt-0.5 text-[11px] opacity-80 break-all">{detail}</p>
    </div>
  );
};

const SemanticAnalysis = () => {
  const navigate = useNavigate();
  const { user, isAdmin, loading: authLoading } = useAuth();
  const [rows, setRows] = useState<IdentifierRow[]>([]);
  const [sources, setSources] = useState<Record<string, SourceRow>>({});
  const [analyses, setAnalyses] = useState<Record<string, AnalysisRow>>({});
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!authLoading && (!user || !isAdmin)) navigate("/");
  }, [authLoading, user, isAdmin, navigate]);

  const load = useCallback(async () => {
    setLoading(true);
    const { data: ids, error } = await supabase
      .from("intuizi_identifiers")
      .select(
        "id, primary_identifier, ctv_signals, apps_signals, visitation_signals, demographics_signals, origin_signals, tag_codes, audio_source_id, observation_count, last_seen_at, updated_at",
      )
      .order("updated_at", { ascending: false })
      .limit(100);

    if (error) {
      toast({
        title: "Could not load identifiers",
        description: error.message,
        variant: "destructive",
      });
      setLoading(false);
      return;
    }

    const identifiers = (ids ?? []) as unknown as IdentifierRow[];
    setRows(identifiers);

    const sourceIds = identifiers
      .map((r) => r.audio_source_id)
      .filter((v): v is string => !!v);

    if (sourceIds.length) {
      const [srcRes, anaRes] = await Promise.all([
        supabase
          .from("audio_sources")
          .select("id, name, analysis_status, analysis_error, profile_embedding")
          .in("id", sourceIds),
        supabase
          .from("source_analyses")
          .select(
            "audio_source_id, category, confidence, created_at, emotional_score, cognitive_score, social_score, communication_score, contextual_score, artistic_score",
          )
          .in("audio_source_id", sourceIds)
          .order("created_at", { ascending: false }),
      ]);

      const srcMap: Record<string, SourceRow> = {};
      for (const s of (srcRes.data ?? []) as unknown as SourceRow[]) srcMap[s.id] = s;
      setSources(srcMap);

      const anaMap: Record<string, AnalysisRow> = {};
      for (const a of (anaRes.data ?? []) as unknown as AnalysisRow[]) {
        if (a.audio_source_id && !anaMap[a.audio_source_id]) anaMap[a.audio_source_id] = a;
      }
      setAnalyses(anaMap);
    } else {
      setSources({});
      setAnalyses({});
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (isAdmin) load();
  }, [isAdmin, load]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) =>
        r.primary_identifier.toLowerCase().includes(q) ||
        (r.tag_codes ?? []).some((t) => t.toLowerCase().includes(q)),
    );
  }, [rows, query]);

  const totals = useMemo(() => {
    let normalized = 0;
    let created = 0;
    let scored = 0;
    for (const r of rows) {
      const hasSignals =
        nonEmpty(r.ctv_signals) ||
        nonEmpty(r.apps_signals) ||
        nonEmpty(r.visitation_signals) ||
        nonEmpty(r.demographics_signals) ||
        nonEmpty(r.origin_signals);
      if (hasSignals) normalized++;
      if (r.audio_source_id) created++;
      if (r.audio_source_id && analyses[r.audio_source_id]) scored++;
    }
    return { normalized, created, scored, total: rows.length };
  }, [rows, analyses]);

  if (authLoading || !isAdmin) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 px-4 py-4">
          <Button variant="ghost" size="sm" onClick={() => navigate("/admin/pipeline")}>
            <ArrowLeft className="mr-1 h-4 w-4" />
            Pipeline
          </Button>
          <div className="flex items-center gap-2">
            <Layers className="h-5 w-5 text-primary" />
            <h1 className="text-lg font-semibold">Post-ingestion semantic analysis</h1>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="ml-auto"
            onClick={load}
            disabled={loading}
          >
            {loading ? (
              <Loader2 className="mr-1 h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="mr-1 h-4 w-4" />
            )}
            Refresh
          </Button>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6">
        <div className="grid gap-3 sm:grid-cols-4">
          {[
            ["Identifiers", totals.total],
            ["Normalized", totals.normalized],
            ["Sources created", totals.created],
            ["Scored", totals.scored],
          ].map(([label, value]) => (
            <Card key={String(label)} className="p-4">
              <p className="text-xs text-muted-foreground">{label}</p>
              <p className="text-2xl font-semibold">{value as number}</p>
            </Card>
          ))}
        </div>

        <div className="mt-6">
          <InspectMappingPanel />
        </div>



        <div className="mt-6">
          <Input
            placeholder="Filter by identifier or tag code…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="max-w-sm"
          />
        </div>

        <div className="mt-4 space-y-3">
          {loading && rows.length === 0 && (
            <Card className="p-6 text-sm text-muted-foreground">Loading identifiers…</Card>
          )}
          {!loading && filtered.length === 0 && (
            <Card className="p-6 text-sm text-muted-foreground">
              No ingested identifiers yet. Once a delivery contains data rows, each identifier
              will appear here with its normalization, source creation, and scoring status.
            </Card>
          )}

          {filtered.map((r) => {
            const signalGroups = [
              ["ctv", r.ctv_signals],
              ["apps", r.apps_signals],
              ["visitation", r.visitation_signals],
              ["demographics", r.demographics_signals],
              ["origin", r.origin_signals],
            ] as const;
            const present = signalGroups
              .filter(([, v]) => nonEmpty(v as Record<string, unknown>))
              .map(([k]) => k);
            const tags = r.tag_codes ?? [];

            const normState: StepState = present.length ? "ok" : "pending";
            const src = r.audio_source_id ? sources[r.audio_source_id] : undefined;
            const createState: StepState = !r.audio_source_id
              ? "pending"
              : src?.analysis_status === "failed"
                ? "error"
                : "ok";
            const ana = r.audio_source_id ? analyses[r.audio_source_id] : undefined;
            const scoreState: StepState = ana
              ? "ok"
              : src?.analysis_status === "failed"
                ? "error"
                : "pending";

            return (
              <Card key={r.id} className="p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-mono text-sm break-all">{r.primary_identifier}</p>
                  <Badge variant="outline" className="text-xs">
                    {r.observation_count} obs
                  </Badge>
                  {ana?.category && <Badge className="text-xs">{ana.category}</Badge>}
                  <span className="ml-auto text-xs text-muted-foreground">
                    updated {relative(r.updated_at)}
                  </span>
                </div>

                <div className="mt-3 grid gap-2 md:grid-cols-3">
                  <StepPill
                    label="1. Normalization"
                    state={normState}
                    detail={
                      present.length
                        ? `signals: ${present.join(", ")} · ${tags.length} tag code${tags.length === 1 ? "" : "s"}`
                        : "no signal groups captured"
                    }
                  />
                  <StepPill
                    label="2. Source creation"
                    state={createState}
                    detail={
                      src
                        ? `${src.name} · ${src.analysis_status}${src.profile_embedding ? " · embedded" : ""}`
                        : "no audio source linked"
                    }
                  />
                  <StepPill
                    label="3. Scoring"
                    state={scoreState}
                    detail={
                      ana
                        ? `${CATEGORY_KEYS.map(([k, short]) => `${short} ${Math.round(Number(ana[k]))}`).join(" · ")} · conf ${Number(ana.confidence ?? 0).toFixed(2)}`
                        : src?.analysis_error || "awaiting analyze-audio"
                    }
                  />
                </div>

                {tags.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-1">
                    {tags.slice(0, 12).map((t) => (
                      <Badge key={t} variant="secondary" className="text-[11px]">
                        {t}
                      </Badge>
                    ))}
                    {tags.length > 12 && (
                      <Badge variant="secondary" className="text-[11px]">
                        +{tags.length - 12}
                      </Badge>
                    )}
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      </main>
    </div>
  );
};

export default SemanticAnalysis;
