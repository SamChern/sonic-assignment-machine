import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/use-toast";
import { AlertTriangle, CheckCircle2, CircleDashed, Gauge, Loader2, RefreshCw } from "lucide-react";

type Readiness = "not ingested" | "roster only" | "taxonomy present" | "scored";

interface ActivationCoverage {
  activation_id: string;
  identifiers: number;
  tagged: number;
  scored: number;
  tag_coverage: number;
  readiness: Readiness;
}

interface FileRow {
  object_key: string;
  report_type: string | null;
  status: string | null;
  total_rows: number | null;
  processed_rows: number | null;
  failed_rows: number | null;
}

const READINESS_META: Record<
  Readiness,
  { className: string; icon: typeof CheckCircle2; hint: string }
> = {
  scored: {
    className: "bg-primary/15 text-primary border-primary/30",
    icon: CheckCircle2,
    hint: "Identifiers carry ontology scores — normalization and comparison levers apply.",
  },
  "taxonomy present": {
    className: "bg-amber-500/15 text-amber-500 border-amber-500/30",
    icon: AlertTriangle,
    hint: "Taxonomy tags exist but scoring has not completed — re-run the ingest for this activation.",
  },
  "roster only": {
    className: "bg-amber-500/15 text-amber-500 border-amber-500/30",
    icon: AlertTriangle,
    hint: "Device/email roster with no content columns. Ingest the matching CTV, apps, visitation, demographics or origin report to unlock scoring.",
  },
  "not ingested": {
    className: "bg-muted text-muted-foreground border-border",
    icon: CircleDashed,
    hint: "Nothing recorded for this activation yet.",
  },
};

/**
 * Enrichment coverage per Intuizi activation: how many identifiers landed, how
 * many carry taxonomy tags, and how many earned ontology scores — so a
 * roster-only delivery is never mistaken for a fully enriched one.
 */
const EnrichmentReadinessPanel = () => {
  const [loading, setLoading] = useState(false);
  const [activations, setActivations] = useState<ActivationCoverage[]>([]);
  const [files, setFiles] = useState<FileRow[]>([]);
  const [speechBias, setSpeechBias] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [{ data, error }, normRes] = await Promise.all([
        supabase.functions.invoke("intuizi-ingest", { body: { action: "readiness" } }),
        supabase
          .from("semantic_normalization")
          .select("speech_bias, enabled")
          .eq("scope", "intuizi")
          .maybeSingle(),
      ]);
      if (error) throw new Error(error.message);
      const payload = data as { activations?: ActivationCoverage[]; files?: FileRow[] };
      setActivations(payload.activations ?? []);
      setFiles(payload.files ?? []);
      setSpeechBias(
        normRes.data?.enabled ? Number(normRes.data.speech_bias) : null,
      );
    } catch (e) {
      toast({
        title: "Could not read enrichment coverage",
        description: (e as Error).message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-center gap-2">
        <Gauge className="h-5 w-5 text-primary" />
        <h2 className="text-base font-semibold">Enrichment readiness</h2>
        {speechBias != null && (
          <Badge variant="outline" className="text-[11px]">
            speech bias {speechBias.toFixed(2)}
          </Badge>
        )}
        <Button variant="outline" size="sm" className="ml-auto" onClick={load} disabled={loading}>
          {loading ? (
            <Loader2 className="mr-1 h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="mr-1 h-4 w-4" />
          )}
          Refresh
        </Button>
      </div>

      <p className="mt-2 text-xs text-muted-foreground">
        Per activation: identifiers ingested, how many carry taxonomy tags, and how many earned
        six-category ontology scores. Normalization for the <span className="font-mono">intuizi</span>{" "}
        scope is applied to every scored profile.
      </p>

      <div className="mt-4 space-y-2">
        {!activations.length && !loading && (
          <p className="text-xs text-muted-foreground">
            No Intuizi identifiers recorded yet.
          </p>
        )}
        {activations.map((a) => {
          const meta = READINESS_META[a.readiness] ?? READINESS_META["not ingested"];
          const Icon = meta.icon;
          return (
            <div key={a.activation_id} className="rounded-lg border border-border bg-muted/20 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium">
                  {a.activation_id === "unassigned" ? "Unassigned" : `Activation ${a.activation_id}`}
                </span>
                <Badge variant="outline" className={`gap-1 text-[11px] ${meta.className}`}>
                  <Icon className="h-3 w-3" /> {a.readiness}
                </Badge>
              </div>
              <div className="mt-2 grid gap-1 sm:grid-cols-3">
                {[
                  ["Identifiers", String(a.identifiers)],
                  ["Tagged", `${a.tagged} · ${Math.round(a.tag_coverage * 100)}%`],
                  ["Scored", String(a.scored)],
                ].map(([k, v]) => (
                  <div
                    key={k}
                    className="flex items-baseline justify-between gap-2 rounded border border-border/60 bg-background/60 px-2 py-1"
                  >
                    <span className="text-[11px] text-muted-foreground">{k}</span>
                    <span className="text-[11px] font-medium">{v}</span>
                  </div>
                ))}
              </div>
              <p className="mt-2 text-[11px] text-muted-foreground">{meta.hint}</p>
            </div>
          );
        })}
      </div>

      {!!files.length && (
        <div className="mt-4 border-t border-border pt-3">
          <p className="text-xs font-medium">Recent objects</p>
          <div className="mt-2 space-y-1">
            {files.slice(0, 8).map((f) => (
              <div key={f.object_key} className="flex flex-wrap gap-x-3 text-[11px]">
                <span className="font-mono break-all">{f.object_key.split("/").pop()}</span>
                <span className="text-muted-foreground">
                  {f.report_type ?? "?"} · {f.status ?? "?"} · {f.processed_rows ?? 0}/
                  {f.total_rows ?? 0} scored
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
};

export default EnrichmentReadinessPanel;
