import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import {
  AlertTriangle,
  Check,
  Flag,
  Gauge,
  Loader2,
  Play,
  RefreshCw,
  Search,
} from "lucide-react";

export interface ScoreQueueRow {
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

export interface ScoreNode {
  id: string;
  code: string;
  label: string | null;
  reviewed: boolean;
  proposal: {
    description?: string;
    confidence?: number;
    model?: string;
    usd?: number;
    tendencies?: Record<string, number>;
  } | null;
  crosswalk: { matches?: { code: string; similarity?: number }[] } | null;
}

export interface ScoreFlag {
  id: string;
  symbol: string;
  reason: string;
  note: string | null;
  status: string;
  observed_confidence: number | null;
  created_at: string;
}

interface StepRow {
  id: string;
  run_id?: string;
  step: string;
  status: string;
  detail: Record<string, unknown> | null;
  duration_ms: number | null;
  created_at: string;
}

interface RunResult {
  queue_id: string;
  symbol: string;
  ok?: boolean;
  confidence?: number;
  escalated?: boolean;
  usd?: number;
  error?: string;
  steps: StepRow[];
}

const REASONS = ["wrong meaning", "overconfident", "underconfident", "wrong crosswalk", "sensitive"];

const pct = (n?: number | null) => (n === undefined || n === null ? "—" : `${Math.round(n * 100)}%`);

/** Mean of the 6 semantic tendencies, as a single readable score. */
const scoreOf = (node?: ScoreNode | null) => {
  const t = node?.proposal?.tendencies;
  if (!t) return null;
  const vals = Object.values(t).filter((v) => typeof v === "number");
  if (!vals.length) return null;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
};

const stepTone = (status: string) =>
  status === "ok" ? "text-emerald-500" : status === "failed" ? "text-amber-500" : "text-muted-foreground";

interface Props {
  rows: ScoreQueueRow[];
  nodes: Record<string, ScoreNode>;
  flags: ScoreFlag[];
  loading?: boolean;
  onRefresh: () => void | Promise<void>;
}

/**
 * Score quality control: each symbol's derived score, the agent's confidence,
 * the resolver steps behind it, and a one-click flag when a score reads wrong.
 */
export function SymbolScorePanel({ rows, nodes, flags, loading, onRefresh }: Props) {
  const [search, setSearch] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<Record<string, RunResult>>({});
  const [history, setHistory] = useState<Record<string, StepRow[]>>({});
  const [open, setOpen] = useState<string | null>(null);
  const [flagFor, setFlagFor] = useState<string | null>(null);
  const [reason, setReason] = useState(REASONS[0]);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const flagsBySymbol = useMemo(() => {
    const map: Record<string, ScoreFlag[]> = {};
    for (const f of flags) (map[f.symbol] ??= []).push(f);
    return map;
  }, [flags]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? rows.filter((r) => r.symbol.toLowerCase().includes(q)) : rows;
  }, [rows, search]);

  const call = useCallback(async (body: Record<string, unknown>) => {
    const { data, error } = await supabase.functions.invoke("signal-resolver", { body });
    if (error) throw error;
    const res = data as { success?: boolean; error?: string };
    if (res?.success === false) throw new Error(res.error ?? "resolver call failed");
    return data as Record<string, unknown>;
  }, []);

  const toggle = (id: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const runAgent = async () => {
    if (!picked.size) return;
    setRunning(true);
    try {
      const out = (await call({
        action: "resolve_many",
        queue_ids: [...picked],
      })) as { results?: RunResult[] };
      const next: Record<string, RunResult> = {};
      for (const r of out.results ?? []) next[r.queue_id] = r;
      setResults((prev) => ({ ...prev, ...next }));
      const ok = (out.results ?? []).filter((r) => r.ok).length;
      toast.success(`Agent ran ${out.results?.length ?? 0} symbols · ${ok} resolved`);
      setOpen((out.results ?? [])[0]?.queue_id ?? null);
      await onRefresh();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setRunning(false);
    }
  };

  const loadHistory = async (symbol: string) => {
    if (history[symbol]) return;
    try {
      const out = (await call({ action: "steps", symbol })) as { steps?: StepRow[] };
      setHistory((prev) => ({ ...prev, [symbol]: out.steps ?? [] }));
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const submitFlag = async (row: ScoreQueueRow) => {
    setBusy(true);
    try {
      const node = row.resolved_node_id ? nodes[row.resolved_node_id] : null;
      await call({
        action: "flag",
        symbol: row.symbol,
        queue_id: row.id,
        node_id: row.resolved_node_id,
        reason,
        note,
        confidence: node?.proposal?.confidence ?? null,
      });
      toast.success(`Flagged ${row.symbol}`);
      setFlagFor(null);
      setNote("");
      await onRefresh();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const closeFlag = async (id: string) => {
    try {
      await call({ action: "flag", flag_id: id, status: "closed" });
      toast.success("Flag cleared");
      await onRefresh();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const StepList = ({ steps }: { steps: StepRow[] }) => (
    <ol className="space-y-1 border-l border-border/60 pl-3">
      {steps.map((s) => {
        const d = (s.detail ?? {}) as Record<string, unknown>;
        return (
          <li key={s.id} className="text-[11px]">
            <span className={`font-medium ${stepTone(s.status)}`}>{s.step}</span>
            <span className="text-muted-foreground">
              {" "}· {s.status}
              {s.duration_ms !== null ? ` · ${s.duration_ms}ms` : ""}
              {typeof d.confidence === "number" ? ` · conf ${pct(d.confidence as number)}` : ""}
              {typeof d.model === "string" ? ` · ${d.model}` : ""}
            </span>
            {typeof d.description === "string" && (
              <p className="text-[10px] text-muted-foreground">{d.description}</p>
            )}
          </li>
        );
      })}
      {!steps.length && (
        <li className="text-[11px] text-muted-foreground">No recorded steps yet.</li>
      )}
    </ol>
  );

  return (
    <Card className="space-y-3 border-primary/20 bg-card/70 p-4 backdrop-blur">
      <div className="flex flex-wrap items-center gap-2">
        <Gauge className="h-4 w-4 text-primary" />
        <h2 className="text-sm font-semibold">Symbol scores & confidence</h2>
        <Badge variant="outline" className="text-[10px]">
          {flags.filter((f) => f.status === "open").length} open flags
        </Badge>
        <div className="ml-auto flex items-center gap-1">
          <Search className="h-3.5 w-3.5 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter symbols"
            className="h-8 w-36 text-xs"
          />
          <Button
            size="sm"
            className="h-8 text-[11px]"
            disabled={running || !picked.size}
            onClick={runAgent}
          >
            {running ? (
              <Loader2 className="mr-1 h-3 w-3 animate-spin" />
            ) : (
              <Play className="mr-1 h-3 w-3" />
            )}
            Run agent ({picked.size})
          </Button>
          <Button size="sm" variant="ghost" className="h-8" onClick={() => void onRefresh()}>
            {loading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
          </Button>
        </div>
      </div>

      <div className="divide-y divide-border/50 rounded-lg border border-border/60">
        {visible.map((r) => {
          const node = r.resolved_node_id ? nodes[r.resolved_node_id] : null;
          const score = scoreOf(node);
          const conf = node?.proposal?.confidence ?? null;
          const rowFlags = flagsBySymbol[r.symbol] ?? [];
          const openFlags = rowFlags.filter((f) => f.status === "open");
          const result = results[r.id];
          const expanded = open === r.id;
          return (
            <div key={r.id} className="px-3 py-2">
              <div className="flex flex-wrap items-center gap-2">
                <Checkbox
                  checked={picked.has(r.id)}
                  onCheckedChange={() => toggle(r.id)}
                  aria-label={`Select ${r.symbol}`}
                />
                <button
                  type="button"
                  className="font-mono text-[11px] text-primary hover:underline"
                  onClick={() => {
                    setOpen(expanded ? null : r.id);
                    if (!expanded) void loadHistory(r.symbol);
                  }}
                >
                  {r.symbol}
                </button>
                <Badge variant="outline" className="px-1 py-0 text-[9px]">
                  {r.status}
                </Badge>
                <span className="text-[10px] text-muted-foreground">
                  score {score === null ? "—" : Math.round(score * 100)}
                </span>
                <div className="hidden w-24 sm:block">
                  <Progress value={Math.round((conf ?? 0) * 100)} className="h-1.5" />
                </div>
                <span className="text-[10px] text-muted-foreground">conf {pct(conf)}</span>
                {openFlags.length > 0 && (
                  <Badge variant="destructive" className="px-1 py-0 text-[9px]">
                    <AlertTriangle className="mr-0.5 h-2.5 w-2.5" />
                    {openFlags.length}
                  </Badge>
                )}
                {result && (
                  <Badge
                    variant={result.ok ? "secondary" : "outline"}
                    className="px-1 py-0 text-[9px]"
                  >
                    run {result.ok ? "resolved" : "no node"}
                  </Badge>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  className="ml-auto h-7 px-2 text-[10px]"
                  onClick={() => {
                    setFlagFor(flagFor === r.id ? null : r.id);
                    setReason(REASONS[0]);
                  }}
                >
                  <Flag className="mr-1 h-3 w-3" /> Flag
                </Button>
              </div>

              {flagFor === r.id && (
                <div className="mt-2 space-y-2 rounded-lg border border-destructive/30 bg-destructive/5 p-2">
                  <div className="flex flex-wrap gap-1">
                    {REASONS.map((x) => (
                      <Button
                        key={x}
                        size="sm"
                        variant={reason === x ? "secondary" : "ghost"}
                        className="h-6 px-2 text-[10px]"
                        onClick={() => setReason(x)}
                      >
                        {x}
                      </Button>
                    ))}
                  </div>
                  <Textarea
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="What's wrong with this score?"
                    className="min-h-16 text-xs"
                  />
                  <Button
                    size="sm"
                    className="h-7 text-[11px]"
                    disabled={busy}
                    onClick={() => void submitFlag(r)}
                  >
                    {busy ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : null}
                    Submit flag
                  </Button>
                </div>
              )}

              {openFlags.length > 0 && (
                <div className="mt-1 space-y-1">
                  {openFlags.map((f) => (
                    <div key={f.id} className="flex items-center gap-2 text-[10px]">
                      <AlertTriangle className="h-3 w-3 text-amber-500" />
                      <span>{f.reason}</span>
                      {f.note && <span className="text-muted-foreground">— {f.note}</span>}
                      <Button
                        size="sm"
                        variant="ghost"
                        className="ml-auto h-6 px-2 text-[10px]"
                        onClick={() => void closeFlag(f.id)}
                      >
                        <Check className="mr-1 h-3 w-3" /> Clear
                      </Button>
                    </div>
                  ))}
                </div>
              )}

              {expanded && (
                <div className="mt-2 space-y-2 rounded-lg border border-primary/20 bg-muted/20 p-2">
                  {node?.proposal?.description && (
                    <p className="text-[11px] text-muted-foreground">
                      {node.proposal.description}
                    </p>
                  )}
                  {node?.proposal?.tendencies && (
                    <div className="grid gap-1 sm:grid-cols-2">
                      {Object.entries(node.proposal.tendencies).map(([k, v]) => (
                        <div key={k} className="flex items-center gap-2 text-[10px]">
                          <span className="w-24 capitalize text-muted-foreground">{k}</span>
                          <Progress value={Math.round((v ?? 0) * 100)} className="h-1.5 flex-1" />
                          <span>{Math.round((v ?? 0) * 100)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  <div>
                    <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                      This run
                    </p>
                    <StepList steps={result?.steps ?? []} />
                  </div>
                  <div>
                    <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                      Step history
                    </p>
                    <StepList steps={history[r.symbol] ?? []} />
                  </div>
                </div>
              )}
            </div>
          );
        })}
        {!visible.length && (
          <p className="px-3 py-4 text-[11px] text-muted-foreground">
            No symbols match this filter.
          </p>
        )}
      </div>
    </Card>
  );
}
