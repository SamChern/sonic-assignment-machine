// Recent connection-test outcomes for one integration (admin-only table read).
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, History, Loader2, RefreshCw, XCircle } from "lucide-react";
import { replaceLegacyBrandText } from "@/lib/brandText";

interface HistoryRow {
  id: string;
  success: boolean;
  latency_ms: number | null;
  error_message: string | null;
  tested_at: string;
}

export const IntegrationTestHistory = ({
  integrationId,
  refreshKey = 0,
}: {
  integrationId: string;
  refreshKey?: number;
}) => {
  const [rows, setRows] = useState<HistoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error: err } = await supabase
      .from("integration_test_history")
      .select("id, success, latency_ms, error_message, tested_at")
      .eq("integration_id", integrationId)
      .order("tested_at", { ascending: false })
      .limit(10);
    if (err) setError(err.message);
    else {
      setError(null);
      setRows((data ?? []) as HistoryRow[]);
    }
    setLoading(false);
  }, [integrationId]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  return (
    <Card className="p-5 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <History className="h-4 w-4 text-primary" /> Recent connection tests
        </h2>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => void load()}
          disabled={loading}
          aria-label="Refresh test history"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
        </Button>
      </div>

      {loading && rows.length === 0 ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading history…
        </p>
      ) : error ? (
        <p className="text-sm text-destructive">{replaceLegacyBrandText(error)}</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No tests recorded yet. Run <span className="font-medium">Test connection</span> above.
        </p>
      ) : (
        <ul className="divide-y divide-border text-sm">
          {rows.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-2 py-2">
              {r.success ? (
                <Badge className="gap-1 bg-green-600 hover:bg-green-600">
                  <CheckCircle2 className="h-3 w-3" /> Passed
                </Badge>
              ) : (
                <Badge variant="destructive" className="gap-1">
                  <XCircle className="h-3 w-3" /> Failed
                </Badge>
              )}
              <span className="text-muted-foreground">
                {new Date(r.tested_at).toLocaleString()}
              </span>
              {r.latency_ms != null && (
                <span className="text-xs text-muted-foreground">{r.latency_ms}ms</span>
              )}
              {r.error_message && (
                <span className="w-full break-words text-xs text-destructive sm:w-auto">
                  {replaceLegacyBrandText(r.error_message)}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
};

export default IntegrationTestHistory;
