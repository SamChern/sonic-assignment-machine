import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Coins, RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

type Row = {
  activation_id: string;
  total_rows: number;
  done_rows: number;
  pending_rows: number;
  sampled_rows: number;
  sampled_cached_rows: number;
  distinct_signatures: number;
  billable_signatures: number;
};

/**
 * Scoring budget per activation.
 *
 * The credit cost of an activation is NOT its identifier count: identical tag
 * sets resolve from the tag-pattern cache with zero gateway calls. Only a
 * distinct, not-yet-learned tag pattern costs a chat + embedding round trip
 * (measured ~0.003 credits). This panel samples the pending queue per
 * activation so the operator can see free rows versus billable patterns before
 * committing budget to a backlog.
 */
const DEFAULT_CREDITS_PER_PATTERN = 0.003;

const fmt = (n: number) => n.toLocaleString();

export const ActivationCostPanel = () => {
  const { toast } = useToast();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [perPattern, setPerPattern] = useState(String(DEFAULT_CREDITS_PER_PATTERN));

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.rpc("intuizi_activation_cost_estimate", {
      p_sample: 2000,
    });
    setLoading(false);
    if (error) {
      toast({
        title: "Could not read scoring cost",
        description: error.message,
        variant: "destructive",
      });
      return;
    }
    setRows((data ?? []) as Row[]);
  }, [toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const rate = Number.parseFloat(perPattern);
  const creditRate = Number.isFinite(rate) && rate > 0 ? rate : DEFAULT_CREDITS_PER_PATTERN;

  const totalPending = rows.reduce((a, r) => a + r.pending_rows, 0);
  const totalBillable = rows.reduce((a, r) => a + r.billable_signatures, 0);
  const totalCredits = totalBillable * creditRate;

  return (
    <Card className="border-border/60 bg-card/70 p-4 backdrop-blur-sm">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Coins className="h-4 w-4 text-primary" />
        <h3 className="text-sm font-semibold">Scoring credit budget</h3>
        <Badge variant="secondary" className="text-[11px]">
          {rows.length} activations
        </Badge>
        <Button
          size="sm"
          variant="outline"
          className="ml-auto h-7 text-xs"
          onClick={() => void load()}
          disabled={loading}
        >
          <RefreshCw className={`mr-1 h-3 w-3 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      <div className="mb-3 flex flex-wrap items-end gap-3 rounded-lg border border-border/50 bg-muted/10 p-3">
        <label className="text-[11px] text-muted-foreground">
          Credits per new tag pattern
          <Input
            value={perPattern}
            onChange={(e) => setPerPattern(e.target.value)}
            inputMode="decimal"
            className="mt-1 h-7 w-24 text-xs"
          />
        </label>
        <div className="text-xs">
          <div className="text-muted-foreground">Pending identifiers</div>
          <div className="font-mono text-sm">{fmt(totalPending)}</div>
        </div>
        <div className="text-xs">
          <div className="text-muted-foreground">Billable patterns (sampled)</div>
          <div className="font-mono text-sm">{fmt(totalBillable)}</div>
        </div>
        <div className="text-xs">
          <div className="text-muted-foreground">Estimated credits</div>
          <div className="font-mono text-sm text-primary">
            {totalCredits.toFixed(2)}
          </div>
        </div>
      </div>

      <ul className="space-y-2">
        {rows.map((r) => {
          const progress = r.total_rows
            ? Math.round((r.done_rows / r.total_rows) * 100)
            : 0;
          const freePct = r.sampled_rows
            ? Math.round((r.sampled_cached_rows / r.sampled_rows) * 100)
            : 0;
          return (
            <li
              key={r.activation_id}
              className="rounded-lg border border-border/50 bg-muted/10 p-3"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-semibold">
                  Activation {r.activation_id}
                </span>
                <Badge variant="outline" className="text-[10px]">
                  {progress}% scored
                </Badge>
                <span className="ml-auto font-mono text-xs text-primary">
                  ~{(r.billable_signatures * creditRate).toFixed(3)} credits
                </span>
              </div>
              <Progress value={progress} className="mt-2 h-1.5" />
              <div className="mt-2 grid grid-cols-2 gap-2 text-[11px] text-muted-foreground sm:grid-cols-4">
                <span>
                  Scored{" "}
                  <span className="font-mono text-foreground">{fmt(r.done_rows)}</span>
                </span>
                <span>
                  Pending{" "}
                  <span className="font-mono text-foreground">{fmt(r.pending_rows)}</span>
                </span>
                <span>
                  Free from cache{" "}
                  <span className="font-mono text-foreground">{freePct}%</span>
                </span>
                <span>
                  New patterns{" "}
                  <span className="font-mono text-foreground">
                    {fmt(r.billable_signatures)}
                  </span>
                </span>
              </div>
            </li>
          );
        })}
        {!rows.length && !loading && (
          <li className="rounded-lg border border-dashed border-border/50 p-3 text-xs text-muted-foreground">
            No queued activations.
          </li>
        )}
      </ul>

      <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
        Pattern counts come from a 2,000-row sample of each activation's pending
        queue, so they are a lower bound: rows sharing an already-learned tag
        pattern cost nothing, and every new pattern the worker learns removes
        cost from the rest of the backlog.
      </p>
    </Card>
  );
};

export default ActivationCostPanel;
