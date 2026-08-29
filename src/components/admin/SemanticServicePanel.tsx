// Semantic service (EC2 CLAP) health + taxonomy embedding backfill. Admin only.
import { useCallback, useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { supabase } from "@/integrations/supabase/client";
import { Brain, CheckCircle2, Play, RefreshCw, XCircle } from "lucide-react";
import { toast } from "sonner";

interface HealthState {
  ok: boolean;
  configured: boolean;
  latency_ms?: number;
  space?: string | null;
  breaker_open?: boolean;
  health?: Record<string, unknown> | null;
  error?: string;
}

interface Coverage {
  total_nodes: number;
  embedded_nodes: number;
  remaining_nodes: number;
  grounded_nodes?: number;
  configured?: boolean;
  space?: string | null;
}

const pickStr = (o: Record<string, unknown> | null | undefined, key: string): string | null => {
  const v = o?.[key];
  if (typeof v === "string" && v.trim()) return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return null;
};

export const SemanticServicePanel = () => {
  const [health, setHealth] = useState<HealthState | null>(null);
  const [coverage, setCoverage] = useState<Coverage | null>(null);
  const [checking, setChecking] = useState(false);
  const [running, setRunning] = useState(false);

  const refresh = useCallback(async (announce = false) => {
    setChecking(true);
    const [{ data: h }, { data: c }] = await Promise.all([
      supabase.functions.invoke("semantic-embed", { body: { action: "health" } }),
      supabase.functions.invoke("semantic-backfill", { body: { status_only: true } }),
    ]);
    setChecking(false);
    if (h) {
      setHealth({
        ok: Boolean(h.success),
        configured: h.configured !== false,
        latency_ms: h.latency_ms,
        space: h.space ?? null,
        breaker_open: h.breaker_open,
        health: (h.health as Record<string, unknown>) ?? null,
        error: h.error,
      });
      if (announce) {
        h.success
          ? toast.success(`Semantic service healthy (${h.latency_ms ?? "?"}ms)`)
          : toast.error(`Semantic service check failed: ${h.error ?? "unknown"}`);
      }
    }
    if (c) setCoverage(c as Coverage);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const runBackfill = async () => {
    setRunning(true);
    const { data, error } = await supabase.functions.invoke("semantic-backfill", {
      body: { limit: 200 },
    });
    setRunning(false);
    if (error || !data?.success) {
      toast.error(`Backfill failed: ${data?.error ?? error?.message ?? "unknown"}`);
    } else {
      toast.success(
        `Embedded ${data.embedded} taxonomy nodes (${data.remaining_nodes} remaining)`,
      );
    }
    void refresh();
  };

  const pct = coverage && coverage.total_nodes > 0
    ? Math.round((coverage.embedded_nodes / coverage.total_nodes) * 100)
    : 0;
  const meta = health?.health ?? null;

  const rows: Array<[string, string]> = [
    ["Model", pickStr(meta, "model") ?? "not reported"],
    ["Model loaded", pickStr(meta, "model_loaded") ?? "not reported"],
    ["Version", pickStr(meta, "version") ?? "not reported"],
    ["Embedding space", health?.space ?? "not configured"],
    ["Grounded nodes", String(coverage?.grounded_nodes ?? 0)],
  ];

  return (
    <Card className="space-y-4 border-border/60 bg-card/70 p-4 backdrop-blur-sm">
      <div className="flex flex-wrap items-center gap-3">
        <span
          className="flex h-9 w-9 items-center justify-center rounded-lg"
          style={{ background: "var(--gradient-teal)" }}
        >
          <Brain className="h-4 w-4 text-primary-foreground" />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-medium">Semantic service (CLAP)</p>
          <p className="text-xs text-muted-foreground">
            Audio + text embeddings used for taxonomy grounding and similarity.
          </p>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {health ? (
            health.ok ? (
              <Badge className="gap-1 bg-green-600 hover:bg-green-600">
                <CheckCircle2 className="h-3 w-3" /> Healthy · {health.latency_ms ?? "?"}ms
              </Badge>
            ) : (
              <Badge variant="destructive" className="gap-1">
                <XCircle className="h-3 w-3" />
                {health.configured ? "Unreachable" : "Not configured"}
              </Badge>
            )
          ) : (
            <Badge variant="outline">Checking…</Badge>
          )}
          {health?.breaker_open ? <Badge variant="outline">Breaker open</Badge> : null}
          <Button size="sm" variant="outline" onClick={() => void refresh(true)} disabled={checking}>
            <RefreshCw className={`mr-1 h-4 w-4 ${checking ? "animate-spin" : ""}`} /> Refresh
          </Button>
          <Button
            size="sm"
            onClick={() => void runBackfill()}
            disabled={running || !health?.ok || (coverage?.remaining_nodes ?? 0) === 0}
          >
            <Play className={`mr-1 h-4 w-4 ${running ? "animate-pulse" : ""}`} />
            {running ? "Embedding…" : "Backfill taxonomy"}
          </Button>
        </div>
      </div>

      {health && !health.ok && health.error ? (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
          {health.error}
        </p>
      ) : null}

      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>Taxonomy nodes embedded</span>
          <span className="font-mono">
            {coverage?.embedded_nodes ?? 0} / {coverage?.total_nodes ?? 0} ({pct}%)
          </span>
        </div>
        <Progress value={pct} className="h-2" />
      </div>

      <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {rows.map(([label, value]) => (
          <div key={label} className="rounded-md border border-border/60 bg-background/40 p-3">
            <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</dt>
            <dd className="mt-0.5 break-words font-mono text-xs">{value}</dd>
          </div>
        ))}
      </dl>
    </Card>
  );
};

export default SemanticServicePanel;
