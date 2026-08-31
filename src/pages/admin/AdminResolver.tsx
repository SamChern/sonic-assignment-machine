import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { ArrowLeft, Bot, Loader2, RefreshCw, Search } from "lucide-react";
import { ResolverNudge } from "@/components/admin/ResolverNudge";
import { ResolverPanel } from "@/components/admin/ResolverPanel";
import { AdminToolsPanel } from "@/components/admin/AdminToolsPanel";
import { SymbolScorePanel, type ScoreFlag } from "@/components/admin/SymbolScorePanel";
import { GroundingFlagPanel } from "@/components/admin/GroundingFlagPanel";



interface QueueRow {
  id: string;
  symbol: string;
  symbol_type: string;
  status: string;
  attempts: number;
  sightings: number;
  last_error: string | null;
  resolved_node_id: string | null;
  first_seen_at: string;
  last_seen_at: string;
  context: Record<string, unknown> | null;
}

interface NodeRow {
  id: string;
  code: string;
  label: string | null;
  reviewed: boolean;
  proposal: { description?: string; confidence?: number; model?: string } | null;
  crosswalk: { matches?: { code: string; similarity?: number }[] } | null;
}

const STATUSES = ["pending", "resolved", "failed", "skipped", "all"] as const;
const PAGE = 50;

const when = (iso: string) => new Date(iso).toLocaleString();

/**
 * The Resolver, as a first-class admin surface: the queue of symbols the
 * ontology hasn't met, the detail of any one of them, and a refresh button that
 * fires the agent and lands you on the nudge card.
 */
export default function AdminResolver() {
  const { user, isAdmin, loading: authLoading } = useAuth();
  const navigate = useNavigate();

  const [rows, setRows] = useState<QueueRow[]>([]);
  const [nodes, setNodes] = useState<Record<string, NodeRow>>({});
  const [flags, setFlags] = useState<ScoreFlag[]>([]);
  const [total, setTotal] = useState<number | null>(null);

  const [status, setStatus] = useState<string>("pending");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    if (!authLoading && (!user || !isAdmin)) navigate("/");
  }, [authLoading, user, isAdmin, navigate]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("signal-resolver", {
        body: { action: "queue", status, search, limit: PAGE, offset: page * PAGE },
      });
      if (error) throw error;
      const res = data as {
        success?: boolean;
        error?: string;
        rows?: QueueRow[];
        total?: number | null;
        nodes?: NodeRow[];
        flags?: ScoreFlag[];
      };
      if (res?.success === false) throw new Error(res.error ?? "queue read failed");
      setRows(res.rows ?? []);
      setTotal(res.total ?? null);
      setNodes(Object.fromEntries((res.nodes ?? []).map((n) => [n.id, n])));
      setFlags(res.flags ?? []);

    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [status, search, page]);

  useEffect(() => {
    if (!isAdmin) return;
    void load();
  }, [isAdmin, load]);

  const fireRefresh = async () => {
    setRefreshing(true);
    try {
      const { data, error } = await supabase.functions.invoke("signal-resolver", {
        body: { action: "nudge", refresh: true },
      });
      if (error) throw error;
      const res = data as {
        refreshed?: boolean;
        outcome?: { resolved?: number; remaining?: number } | null;
      };
      const o = res.outcome ?? {};
      toast[res.refreshed ? "success" : "info"](
        res.refreshed
          ? `Resolved ${o.resolved ?? 0} · ${o.remaining ?? 0} still queued`
          : "Signals are above threshold — nothing needed refreshing.",
      );
      await load();
      document.getElementById("nudge")?.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setRefreshing(false);
    }
  };

  const detail = useMemo(() => rows.find((r) => r.id === selected) ?? null, [rows, selected]);
  const detailNode = detail?.resolved_node_id ? nodes[detail.resolved_node_id] : null;

  if (authLoading || !isAdmin) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-6xl space-y-4 px-4 py-6">
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="ghost" className="h-8" onClick={() => navigate("/admin")}>
            <ArrowLeft className="mr-1 h-4 w-4" /> Admin
          </Button>
          <Bot className="h-5 w-5 text-primary" />
          <h1 className="text-lg font-semibold">The Resolver</h1>
          {total !== null && (
            <Badge variant="outline" className="text-[10px]">~{total} rows</Badge>
          )}
          <Button
            size="sm"
            className="ml-auto h-8 text-[11px]"
            disabled={refreshing}
            onClick={fireRefresh}
          >
            {refreshing ? (
              <Loader2 className="mr-1 h-3 w-3 animate-spin" />
            ) : (
              <RefreshCw className="mr-1 h-3 w-3" />
            )}
            Refresh signals
          </Button>
        </div>

        <div id="nudge" className="scroll-mt-4 space-y-4">
          <ResolverNudge />
        </div>

        <AdminToolsPanel />

        <SymbolScorePanel
          rows={rows}
          nodes={nodes}
          flags={flags}
          loading={loading}
          onRefresh={load}
        />



        <Card className="space-y-3 border-primary/20 bg-card/70 p-4 backdrop-blur">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-semibold">Queue</h2>
            <div className="flex flex-wrap gap-1">
              {STATUSES.map((s) => (
                <Button
                  key={s}
                  size="sm"
                  variant={status === s ? "secondary" : "ghost"}
                  className="h-7 px-2 text-[11px]"
                  onClick={() => {
                    setStatus(s);
                    setPage(0);
                  }}
                >
                  {s}
                </Button>
              ))}
            </div>
            <div className="ml-auto flex items-center gap-1">
              <Search className="h-3.5 w-3.5 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && (setPage(0), void load())}
                placeholder="Search symbols"
                className="h-8 w-40 text-xs"
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

          <div className="divide-y divide-border/50 rounded-lg border border-border/60">
            {rows.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => setSelected(selected === r.id ? null : r.id)}
                className={`flex w-full flex-wrap items-center gap-2 px-3 py-2 text-left hover:bg-muted/30 ${
                  selected === r.id ? "bg-muted/40" : ""
                }`}
              >
                <span className="font-mono text-[11px] text-primary">{r.symbol}</span>
                <Badge variant="outline" className="px-1 py-0 text-[9px]">{r.symbol_type}</Badge>
                <Badge
                  variant={r.status === "resolved" ? "secondary" : "outline"}
                  className="px-1 py-0 text-[9px]"
                >
                  {r.status}
                </Badge>
                <span className="text-[10px] text-muted-foreground">
                  {r.sightings} sighting{r.sightings === 1 ? "" : "s"} · {r.attempts} attempt
                  {r.attempts === 1 ? "" : "s"}
                </span>
                <span className="ml-auto text-[10px] text-muted-foreground">
                  {when(r.last_seen_at)}
                </span>
              </button>
            ))}
            {!loading && !rows.length && (
              <p className="px-3 py-4 text-[11px] text-muted-foreground">
                No rows for this filter.
              </p>
            )}
          </div>

          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-[11px]"
              disabled={page === 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
            >
              Previous
            </Button>
            <span className="text-[11px] text-muted-foreground">page {page + 1}</span>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-[11px]"
              disabled={rows.length < PAGE}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </Button>
          </div>

          {detail && (
            <div className="space-y-2 rounded-lg border border-primary/30 bg-muted/20 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-xs text-primary">{detail.symbol}</span>
                <Badge variant="outline" className="px-1 py-0 text-[9px]">{detail.status}</Badge>
                {detailNode && (
                  <Badge variant="outline" className="px-1 py-0 text-[9px]">
                    {detailNode.reviewed ? "reviewed" : "awaiting review"}
                  </Badge>
                )}
              </div>
              <div className="grid gap-1 text-[11px] text-muted-foreground sm:grid-cols-2">
                <span>First seen {when(detail.first_seen_at)}</span>
                <span>Last seen {when(detail.last_seen_at)}</span>
                <span>Sightings {detail.sightings}</span>
                <span>Attempts {detail.attempts}</span>
              </div>
              {detail.last_error && (
                <p className="text-[11px] text-amber-500">{detail.last_error}</p>
              )}
              {detailNode && (
                <div className="space-y-1">
                  <p className="text-[11px]">
                    <span className="font-mono text-primary">{detailNode.code}</span>{" "}
                    {detailNode.label}
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    {detailNode.proposal?.description}
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {(detailNode.crosswalk?.matches ?? []).map((m) => (
                      <Badge key={m.code} variant="outline" className="px-1 py-0 text-[9px]">
                        {m.code} {Math.round((m.similarity ?? 0) * 100)}%
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
              {detail.context && Object.keys(detail.context).length > 0 && (
                <pre className="max-h-40 overflow-auto rounded bg-background/60 p-2 text-[10px]">
                  {JSON.stringify(detail.context, null, 2)}
                </pre>
              )}
            </div>
          )}
        </Card>

        <ResolverPanel />
      </div>
    </div>
  );
}
