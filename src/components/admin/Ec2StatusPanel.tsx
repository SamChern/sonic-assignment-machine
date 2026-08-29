// EC2 connection status: region/instance details reported by the analysis API,
// a rolling log of recent health checks, and manual refresh / reconnect actions.
import { useCallback, useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useEC2Api } from "@/hooks/useEC2Api";
import { EC2_ENDPOINTS } from "@/config/ec2";
import { Activity, CheckCircle2, Plug, RefreshCw, Server, XCircle } from "lucide-react";
import { toast } from "sonner";
import SemanticServicePanel from "./SemanticServicePanel";
import ScoringRegressionPanel from "./ScoringRegressionPanel";


interface HealthCheck {
  at: string;
  ok: boolean;
  latency_ms: number;
  detail: string;
}

const HISTORY_KEY = "sonicsim.ec2.healthHistory";
const MAX_HISTORY = 10;

const readHistory = (): HealthCheck[] => {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as HealthCheck[]) : [];
  } catch {
    return [];
  }
};

const pick = (o: Record<string, unknown>, keys: string[]): string | null => {
  for (const k of keys) {
    const v = o[k];
    if (typeof v === "string" && v.trim()) return v;
    if (typeof v === "number") return String(v);
  }
  return null;
};

export const Ec2StatusPanel = () => {
  const { get } = useEC2Api();
  const [checking, setChecking] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const [history, setHistory] = useState<HealthCheck[]>(() => readHistory());
  const [details, setDetails] = useState<Record<string, unknown> | null>(null);

  const record = useCallback((entry: HealthCheck) => {
    setHistory((prev) => {
      const next = [entry, ...prev].slice(0, MAX_HISTORY);
      try {
        localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
      } catch {
        /* storage unavailable — in-memory only */
      }
      return next;
    });
  }, []);

  const runCheck = useCallback(
    async (announce = false) => {
      setChecking(true);
      const started = performance.now();
      const { data, error } = await get<Record<string, unknown>>(EC2_ENDPOINTS.health);
      const latency = Math.round(performance.now() - started);
      const ok = !error && !!data;
      if (ok) setDetails(data as Record<string, unknown>);
      record({
        at: new Date().toISOString(),
        ok,
        latency_ms: latency,
        detail: ok
          ? (pick(data as Record<string, unknown>, ["status", "state", "message"]) ?? "healthy")
          : (error ?? "unreachable"),
      });
      setChecking(false);
      if (announce) {
        ok ? toast.success(`EC2 healthy (${latency}ms)`) : toast.error(`EC2 check failed: ${error}`);
      }
      return ok;
    },
    [get, record],
  );

  useEffect(() => {
    void runCheck();
  }, [runCheck]);

  const reconnect = async () => {
    setReconnecting(true);
    // Re-probe twice: the first call re-establishes the proxy connection, the
    // second confirms the link is stable before we report success.
    const first = await runCheck();
    const second = await runCheck();
    setReconnecting(false);
    if (first || second) toast.success("Reconnected to the EC2 analysis API");
    else toast.error("Reconnect failed — check AWS_API_URL / AWS_API_KEY and the instance state");
  };

  const latest = history[0];
  const meta = details ?? {};
  const rows: Array<[string, string]> = [
    ["Region", pick(meta, ["region", "aws_region", "availability_zone"]) ?? "not reported"],
    ["Instance", pick(meta, ["instance_id", "instanceId", "instance"]) ?? "not reported"],
    ["Host", pick(meta, ["hostname", "host", "node"]) ?? "not reported"],
    ["Instance type", pick(meta, ["instance_type", "instanceType"]) ?? "not reported"],
    ["Service version", pick(meta, ["version", "build", "commit"]) ?? "not reported"],
    ["Uptime", pick(meta, ["uptime", "uptime_seconds", "started_at"]) ?? "not reported"],
  ];

  return (
    <div className="space-y-4">
      <Card className="space-y-4 border-border/60 bg-card/70 p-4 backdrop-blur-sm">
        <div className="flex flex-wrap items-center gap-3">
          <span
            className="flex h-9 w-9 items-center justify-center rounded-lg"
            style={{ background: "var(--gradient-teal)" }}
          >
            <Server className="h-4 w-4 text-primary-foreground" />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-medium">EC2 analysis API</p>
            <p className="text-xs text-muted-foreground">
              Librosa / embedding service reached through the secured AWS proxy.
            </p>
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {latest ? (
              latest.ok ? (
                <Badge className="gap-1 bg-green-600 hover:bg-green-600">
                  <CheckCircle2 className="h-3 w-3" /> Connected · {latest.latency_ms}ms
                </Badge>
              ) : (
                <Badge variant="destructive" className="gap-1">
                  <XCircle className="h-3 w-3" /> Unreachable
                </Badge>
              )
            ) : (
              <Badge variant="outline">Checking…</Badge>
            )}
            <Button size="sm" variant="outline" onClick={() => void runCheck(true)} disabled={checking}>
              <RefreshCw className={`mr-1 h-4 w-4 ${checking ? "animate-spin" : ""}`} /> Refresh
            </Button>
            <Button size="sm" onClick={() => void reconnect()} disabled={reconnecting}>
              <Plug className={`mr-1 h-4 w-4 ${reconnecting ? "animate-pulse" : ""}`} />
              {reconnecting ? "Reconnecting…" : "Reconnect"}
            </Button>
          </div>
        </div>

        <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map(([label, value]) => (
            <div key={label} className="rounded-md border border-border/60 bg-background/40 p-3">
              <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</dt>
              <dd className="mt-0.5 break-words font-mono text-xs">{value}</dd>
            </div>
          ))}
        </dl>
      </Card>

      <SemanticServicePanel />

      <ScoringRegressionPanel />



      <Card className="border-border/60 bg-card/70 p-4 backdrop-blur-sm">
        <div className="mb-3 flex items-center gap-2">
          <Activity className="h-4 w-4 text-primary" />
          <p className="text-sm font-medium">Recent health checks</p>
        </div>
        {history.length === 0 ? (
          <p className="text-xs text-muted-foreground">No checks recorded yet.</p>
        ) : (
          <ul className="divide-y divide-border/60 text-xs">
            {history.map((h) => (
              <li key={h.at} className="flex flex-wrap items-center gap-2 py-2">
                {h.ok ? (
                  <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-green-500" />
                ) : (
                  <XCircle className="h-3.5 w-3.5 shrink-0 text-destructive" />
                )}
                <span className="text-muted-foreground">{new Date(h.at).toLocaleString()}</span>
                <span className="font-mono">{h.latency_ms}ms</span>
                <span className="min-w-0 flex-1 truncate text-muted-foreground">{h.detail}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
};

export default Ec2StatusPanel;
