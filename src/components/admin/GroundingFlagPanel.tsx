import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { AlertTriangle, Brain, Check, Loader2, RefreshCw, Search, Sparkles } from "lucide-react";

interface QueueRow {
  id: string;
  symbol: string;
  symbol_type: string;
  status: string;
  attempts: number;
  sightings: number;
  last_error: string | null;
  resolved_node_id: string | null;
  last_seen_at: string;
}

interface NodeRow {
  id: string;
  code: string;
  label: string | null;
  reviewed: boolean;
  proposal: {
    description?: string;
    confidence?: number;
    model?: string;
    tendencies?: Record<string, number>;
  } | null;
}

interface StepRow {
  id: string;
  step: string;
  status: string;
  detail: Record<string, unknown> | null;
  duration_ms: number | null;
  created_at: string;
}

interface FlagRow {
  id: string;
  symbol: string;
  reason: string;
  note: string | null;
  status: string;
  observed_confidence: number | null;
  created_at: string;
}

const MANUAL_REASON = "manual grounding requested";

const pct = (n?: number | null) =>
  n === undefined || n === null ? "—" : `${Math.round(Number(n) * 100)}%`;

const tone = (status: string) =>
  status === "ok"
    ? "text-emerald-500"
    : status === "failed"
      ? "text-amber-500"
      : "text-muted-foreground";

/**
 * Grounding flags — the ungrounded end of the ontology. Pick a symbol the
 * resolver never landed on a node, request a manual grounding run, and read back
 * exactly what the agent thought: each step it took, the node it proposed, its
 * confidence and the model behind it.
 */
export function GroundingFlagPanel() {
  const [rows, setRows] = useState<QueueRow[]>([]);
  const [nodes, setNodes] = useState<Record<string, NodeRow>>({});
  const [flags, setFlags] = useState<FlagRow[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [picked, setPicked] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [running, setRunning] = useState(false);
  const [steps, setSteps] = useState<StepRow[]>([]);
  const [outcome, setOutcome] = useState<{
    symbol: string;
    ok?: boolean;
    confidence?: number;
    error?: string;
  } | null>(null);

  const call = useCallback(async (body: Record<string, unknown>) => {
    const { data, error } = await supabase.functions.invoke("signal-resolver", { body });
    if (error) throw error;
    const res = data as { success?: boolean; error?: string };
    if (res?.success === false) throw new Error(res.error ?? "resolver call failed");
    return data as Record<string, unknown>;
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const out = (await call({ action: "queue", status: "all", search, limit: 200 })) as {
        rows?: QueueRow[];
        nodes?: NodeRow[];
        flags?: FlagRow[];
      };
      setRows(out.rows ?? []);
      setNodes(Object.fromEntries((out.nodes ?? []).map((n) => [n.id, n])));
      setFlags(out.flags ?? []);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [call, search]);

  useEffect(() => {
    void load();
  }, [load]);

  // Ungrounded = the resolver has no node for it, whatever the queue status says.
  const ungrounded = useMemo(
    () => rows.filter((r) => !r.resolved_node_id).sort((a, b) => b.sightings - a.sightings),
    [rows],
  );

  const openFlags = useMemo(() => flags.filter((f) => f.status === "open"), [flags]);
  const flaggedSymbols = useMemo(() => new Set(openFlags.map((f) => f.symbol)), [openFlags]);
  const row = useMemo(() => ungrounded.find((r) => r.id === picked) ?? null, [ungrounded, picked]);

  const runGrounding = async () => {
    if (!row) return;
    setRunning(true);
    setSteps([]);
    setOutcome(null);
    try {
      // The flag is the audit trail: who asked for this run and why.
      await call({
        action: "flag",
        symbol: row.symbol,
        queue_id: row.id,
        reason: MANUAL_REASON,
        note: note.trim().slice(0, 1000) || null,
      });

      const out = (await call({ action: "resolve_many", queue_ids: [row.id] })) as {
        results?: {
          queue_id: string;
          symbol: string;
          ok?: boolean;
          confidence?: number;
          error?: string;
          steps?: StepRow[];
        }[];
      };
      const result = (out.results ?? [])[0];
      setSteps(result?.steps ?? []);
      setOutcome(
        result
          ? {
              symbol: result.symbol,
              ok: result.ok,
              confidence: result.confidence,
              error: result.error,
            }
          : { symbol: row.symbol, ok: false, error: "agent returned no result" },
      );

      // Fall back to the recorded trace when the run itself returned none.
      if (!result?.steps?.length) {
        const trace = (await call({ action: "steps", symbol: row.symbol })) as {
          steps?: StepRow[];
        };
        setSteps((trace.steps ?? []).slice(0, 20));
      }

      toast[result?.ok ? "success" : "info"](
        result?.ok
          ? `Grounded ${row.symbol} at ${pct(result.confidence)} confidence`
          : `Agent could not ground ${row.symbol}`,
      );
      setNote("");
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setRunning(false);
    }
  };

  const closeFlag = async (id: string) => {
    try {
      await call({ action: "flag", flag_id: id, status: "closed" });
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <Card className="space-y-3 border-primary/20 bg-card/70 p-4 backdrop-blur">
      <div className="flex flex-wrap items-center gap-2">
        <AlertTriangle className="h-4 w-4 text-amber-500" />
        <h2 className="text-sm font-semibold">Ungrounded symbols &amp; grounding flags</h2>
        <Badge variant="outline" className="text-[10px]">
          {ungrounded.length} ungrounded
        </Badge>
        <Badge variant="outline" className="text-[10px]">
          {openFlags.length} open flags
        </Badge>
        <div className="ml-auto flex items-center gap-1">
          <Search className="h-3.5 w-3.5 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Find a symbol"
            className="h-8 w-36 text-xs"
          />
          <Button size="sm" variant="ghost" className="h-8" onClick={() => void load()}>
            {loading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
          </Button>
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        {/* Pick one ungrounded symbol */}
        <div className="max-h-72 space-y-1 overflow-y-auto rounded-lg border border-border/60 p-1">
          {ungrounded.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => {
                setPicked(r.id === picked ? null : r.id);
                setSteps([]);
                setOutcome(null);
              }}
              aria-pressed={r.id === picked}
              className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[11px] transition-colors ${
                r.id === picked ? "bg-primary/10 ring-1 ring-primary/40" : "hover:bg-muted/30"
              }`}
            >
              <span className="min-w-0 flex-1 truncate font-mono">{r.symbol}</span>
              {flaggedSymbols.has(r.symbol) && (
                <Badge variant="destructive" className="px-1 py-0 text-[9px]">
                  flagged
                </Badge>
              )}
              <Badge variant="outline" className="px-1 py-0 text-[9px]">
                {r.status}
              </Badge>
              <span className="shrink-0 text-muted-foreground">{r.sightings}×</span>
            </button>
          ))}
          {!ungrounded.length && (
            <p className="px-2 py-6 text-center text-[11px] text-muted-foreground">
              {loading ? "Loading queue…" : "Every symbol in the queue has a node. Nothing to ground."}
            </p>
          )}
        </div>

        {/* Request the run, then read the agent's reasoning */}
        <div className="space-y-3 rounded-lg border border-border/60 p-3">
          {!row ? (
            <p className="py-8 text-center text-[11px] text-muted-foreground">
              Select an ungrounded symbol to request a manual grounding run.
            </p>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <Sparkles className="h-3.5 w-3.5 text-primary" />
                <span className="font-mono text-[11px]">{row.symbol}</span>
                <Badge variant="outline" className="px-1 py-0 text-[9px]">
                  {row.symbol_type}
                </Badge>
                <span className="text-[10px] text-muted-foreground">
                  {row.attempts} attempts · seen {row.sightings}×
                </span>
              </div>

              {row.last_error && (
                <p className="rounded bg-amber-500/10 p-2 text-[10px] text-amber-600">
                  Last error: {row.last_error}
                </p>
              )}

              <Textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                maxLength={1000}
                placeholder="Why this needs a manual grounding (recorded on the flag)"
                className="min-h-[56px] text-xs"
              />

              <Button
                size="sm"
                className="h-8 text-[11px]"
                disabled={running}
                onClick={runGrounding}
              >
                {running ? (
                  <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                ) : (
                  <Brain className="mr-1 h-3 w-3" />
                )}
                Flag &amp; run manual grounding
              </Button>

              {outcome && (
                <div className="space-y-1 rounded-lg bg-muted/20 p-2 text-[11px]">
                  <p className="font-medium">
                    {outcome.ok ? "Grounded" : "Not grounded"}
                    <span className="text-muted-foreground">
                      {" "}· confidence {pct(outcome.confidence)}
                    </span>
                  </p>
                  {outcome.error && <p className="text-amber-600">{outcome.error}</p>}
                </div>
              )}

              {(steps.length > 0 || running) && (
                <div>
                  <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Agent reasoning
                  </p>
                  <ol className="space-y-1 border-l border-border/60 pl-3">
                    {steps.map((s) => {
                      const d = (s.detail ?? {}) as Record<string, unknown>;
                      return (
                        <li key={s.id} className="text-[11px]">
                          <span className={`font-medium ${tone(s.status)}`}>{s.step}</span>
                          <span className="text-muted-foreground">
                            {" "}· {s.status}
                            {s.duration_ms !== null ? ` · ${s.duration_ms}ms` : ""}
                            {typeof d.confidence === "number"
                              ? ` · conf ${pct(d.confidence as number)}`
                              : ""}
                            {typeof d.model === "string" ? ` · ${d.model}` : ""}
                          </span>
                          {typeof d.description === "string" && (
                            <p className="text-[10px] text-muted-foreground">
                              {d.description as string}
                            </p>
                          )}
                          {typeof d.reason === "string" && (
                            <p className="text-[10px] text-muted-foreground">{d.reason as string}</p>
                          )}
                        </li>
                      );
                    })}
                    {!steps.length && running && (
                      <li className="text-[11px] text-muted-foreground">Agent is working…</li>
                    )}
                  </ol>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {openFlags.length > 0 && (
        <div className="space-y-1 rounded-lg border border-destructive/30 bg-destructive/5 p-2">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            Open flags
          </p>
          <ul className="space-y-1">
            {openFlags.slice(0, 12).map((f) => (
              <li key={f.id} className="flex items-center gap-2 text-[11px]">
                <span className="font-mono">{f.symbol}</span>
                <span className="text-muted-foreground">{f.reason}</span>
                {f.note && <span className="truncate text-muted-foreground">— {f.note}</span>}
                <Button
                  size="sm"
                  variant="ghost"
                  className="ml-auto h-6 px-2 text-[10px]"
                  onClick={() => void closeFlag(f.id)}
                >
                  <Check className="mr-1 h-3 w-3" /> Clear
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}

export default GroundingFlagPanel;
