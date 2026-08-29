import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { Bot, Check, Loader2, PauseCircle, RefreshCw, Search, X } from "lucide-react";

interface AgentProposal {
  id: string;
  code: string;
  label: string | null;
  created_at: string;
  proposal: {
    description?: string;
    confidence?: number;
    model?: string;
    usd?: number;
    symbol_type?: string;
    tendencies?: Record<string, number>;
    sources?: { source: string; title: string; url?: string }[];
  } | null;
  crosswalk: { matches?: { code: string; label?: string; similarity?: number }[] } | null;
}

interface ResolverStatus {
  counts: Record<string, number>;
  pending: number;
  spend_today: number;
  budget: number;
  enabled: boolean;
  model: string;
  state: { paused: boolean; pause_reason?: string | null; last_error?: string | null };
  proposals: AgentProposal[];
}

const pct = (n?: number) => `${Math.round((n ?? 0) * 100)}%`;

/**
 * Step 13 — The Resolver. Queue health, nightly spend against budget, the
 * agent's unreviewed proposals, and a "Resolve now" box for one symbol.
 */
export const ResolverPanel = () => {
  const [status, setStatus] = useState<ResolverStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [symbol, setSymbol] = useState("");

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
      const data = await call({ action: "status" });
      setStatus(data as unknown as ResolverStatus);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [call]);

  useEffect(() => {
    void load();
  }, [load]);

  const run = async () => {
    setBusy("run");
    try {
      const out = await call({ action: "run" }) as {
        resolved?: number;
        failed?: number;
        halted?: string | null;
        remaining?: number;
      };
      toast.success(
        `Resolved ${out.resolved ?? 0} · failed ${out.failed ?? 0} · ${out.remaining ?? 0} pending${
          out.halted ? ` · halted: ${out.halted}` : ""
        }`,
      );
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const resolveNow = async () => {
    const s = symbol.trim();
    if (!s) return;
    setBusy("one");
    try {
      const out = await call({ action: "resolve_one", symbol: s }) as {
        node_id?: string | null;
        confidence?: number;
      };
      toast.success(
        out.node_id
          ? `Resolved ${s} (${pct(out.confidence)} confidence) — awaiting review`
          : `${s} came back below the confidence floor and stays queued`,
      );
      setSymbol("");
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const review = async (id: string, decision: "approve" | "reject") => {
    setBusy(id);
    try {
      await call({ action: "review", node_id: id, decision });
      toast.success(decision === "approve" ? "Promoted into the live graph" : "Proposal rejected");
      setStatus((prev) =>
        prev ? { ...prev, proposals: prev.proposals.filter((p) => p.id !== id) } : prev
      );
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const budgetUsed = useMemo(() => {
    if (!status?.budget) return 0;
    return Math.min(100, (status.spend_today / status.budget) * 100);
  }, [status]);

  return (
    <Card className="space-y-4 border-primary/20 bg-card/70 p-4 backdrop-blur">
      <div className="flex flex-wrap items-center gap-2">
        <Bot className="h-4 w-4 text-primary" />
        <h3 className="text-sm font-semibold">The Resolver</h3>
        {status && (
          <>
            <Badge variant={status.enabled ? "secondary" : "outline"} className="text-[10px]">
              {status.enabled ? "enabled" : "disabled"}
            </Badge>
            <Badge variant="outline" className="font-mono text-[10px]">{status.model}</Badge>
            <Badge variant="outline" className="text-[10px]">
              {status.pending} queued
            </Badge>
            {status.state?.paused && (
              <Badge variant="outline" className="gap-1 text-[10px] text-amber-500">
                <PauseCircle className="h-3 w-3" />
                paused
              </Badge>
            )}
          </>
        )}
        <div className="ml-auto flex gap-1">
          <Button size="sm" variant="ghost" className="h-7 text-[11px]" onClick={load}>
            {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-[11px]"
            disabled={busy === "run"}
            onClick={run}
          >
            {busy === "run" ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : null}
            Run drain
          </Button>
        </div>
      </div>

      {status && (
        <div className="space-y-1">
          <div className="flex items-center justify-between text-[11px] text-muted-foreground">
            <span>
              Spend today ${status.spend_today.toFixed(3)} of ${status.budget.toFixed(2)}
            </span>
            <span>
              {Object.entries(status.counts)
                .map(([k, v]) => `${k} ${v}`)
                .join(" · ") || "queue empty"}
            </span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div className="h-full bg-primary transition-all" style={{ width: `${budgetUsed}%` }} />
          </div>
          {(status.state?.pause_reason || status.state?.last_error) && (
            <p className="text-[10px] text-amber-500">
              {status.state.pause_reason ?? status.state.last_error}
            </p>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Search className="h-3.5 w-3.5 text-muted-foreground" />
        <Input
          value={symbol}
          onChange={(e) => setSymbol(e.target.value)}
          placeholder="Resolve now — e.g. ctv.channel.tastemade"
          className="h-8 flex-1 min-w-[200px] text-xs"
          onKeyDown={(e) => e.key === "Enter" && resolveNow()}
        />
        <Button
          size="sm"
          className="h-8 text-[11px]"
          disabled={busy === "one" || !symbol.trim()}
          onClick={resolveNow}
        >
          {busy === "one" ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : null}
          Resolve
        </Button>
      </div>

      <div className="space-y-2">
        <p className="text-[11px] font-medium text-muted-foreground">
          Unreviewed agent proposals ({status?.proposals?.length ?? 0})
        </p>
        {(status?.proposals ?? []).map((p) => (
          <div key={p.id} className="rounded-lg border border-border/60 bg-muted/20 p-2">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="font-mono text-[10px] text-primary">{p.code}</span>
              <span className="truncate text-xs">{p.label}</span>
              <Badge variant="outline" className="px-1 py-0 text-[9px]">
                {pct(p.proposal?.confidence)} conf
              </Badge>
              {p.proposal?.symbol_type && (
                <Badge variant="outline" className="px-1 py-0 text-[9px]">
                  {p.proposal.symbol_type}
                </Badge>
              )}
              <div className="ml-auto flex gap-1">
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 px-1.5 text-[10px]"
                  disabled={busy === p.id}
                  onClick={() => review(p.id, "approve")}
                >
                  <Check className="mr-0.5 h-3 w-3" /> Approve
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 px-1.5 text-[10px]"
                  disabled={busy === p.id}
                  onClick={() => review(p.id, "reject")}
                >
                  <X className="h-3 w-3" />
                </Button>
              </div>
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground">{p.proposal?.description}</p>
            <div className="mt-1 flex flex-wrap gap-1">
              {(p.crosswalk?.matches ?? []).map((m) => (
                <Badge key={m.code} variant="outline" className="px-1 py-0 text-[9px]">
                  {m.code} {pct(m.similarity)}
                </Badge>
              ))}
            </div>
          </div>
        ))}
        {!loading && !(status?.proposals ?? []).length && (
          <p className="text-[11px] text-muted-foreground">
            Nothing awaiting review — the graph knows every symbol delivered so far.
          </p>
        )}
      </div>
    </Card>
  );
};

export default ResolverPanel;
