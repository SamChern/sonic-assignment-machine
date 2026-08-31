import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { ListPlus, Loader2, RefreshCw, Wrench } from "lucide-react";

/**
 * Admin Tools: fire the resolver refresh (the same agent run the nudge card
 * triggers) and hand-queue symbols the pipeline hasn't met yet.
 */
export const AdminToolsPanel = () => {
  const navigate = useNavigate();
  const [symbols, setSymbols] = useState("");
  const [busy, setBusy] = useState<"refresh" | "queue" | null>(null);
  const [lastQueued, setLastQueued] = useState<number | null>(null);

  const call = async (body: Record<string, unknown>) => {
    const { data, error } = await supabase.functions.invoke("signal-resolver", { body });
    if (error) throw error;
    const res = data as { success?: boolean; error?: string };
    if (res?.success === false) throw new Error(res.error ?? "resolver call failed");
    return data as Record<string, unknown>;
  };

  const refresh = async () => {
    setBusy("refresh");
    try {
      const out = (await call({ action: "nudge", refresh: true })) as {
        refreshed?: boolean;
        outcome?: { resolved?: number; remaining?: number } | null;
      };
      if (out.refreshed) {
        const o = out.outcome ?? {};
        toast.success(`Resolver refresh: resolved ${o.resolved ?? 0}, ${o.remaining ?? 0} queued`);
      } else {
        toast.info("Signals are above threshold — nothing needed refreshing.");
      }
      navigate("/admin/resolver#nudge");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const queue = async () => {
    const list = symbols
      .split(/[\n,]/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (!list.length) return;
    setBusy("queue");
    try {
      const out = (await call({ action: "enqueue", symbols: list })) as { queued?: number };
      setLastQueued(out.queued ?? list.length);
      toast.success(`Queued ${out.queued ?? list.length} symbol(s) for the resolver`);
      setSymbols("");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card className="space-y-3 border-primary/20 bg-card/70 p-4 backdrop-blur">
      <div className="flex flex-wrap items-center gap-2">
        <Wrench className="h-4 w-4 text-primary" />
        <h3 className="text-sm font-semibold">Tools</h3>
        {lastQueued !== null && (
          <Badge variant="outline" className="text-[10px]">last queued {lastQueued}</Badge>
        )}
        <Button
          size="sm"
          variant="outline"
          className="ml-auto h-7 text-[11px]"
          disabled={busy === "refresh"}
          onClick={refresh}
        >
          {busy === "refresh" ? (
            <Loader2 className="mr-1 h-3 w-3 animate-spin" />
          ) : (
            <RefreshCw className="mr-1 h-3 w-3" />
          )}
          Refresh resolver
        </Button>
      </div>

      <p className="text-[11px] text-muted-foreground">
        Queue symbols by hand — one per line, or comma separated (e.g. <span className="font-mono">ctv.channel.tastemade</span>).
      </p>
      <Textarea
        value={symbols}
        onChange={(e) => setSymbols(e.target.value)}
        rows={3}
        placeholder={"ctv.genre.docuseries\nweb.topic.homebuying"}
        className="text-xs"
      />
      <Button
        size="sm"
        className="h-8 text-[11px]"
        disabled={busy === "queue" || !symbols.trim()}
        onClick={queue}
      >
        {busy === "queue" ? (
          <Loader2 className="mr-1 h-3 w-3 animate-spin" />
        ) : (
          <ListPlus className="mr-1 h-3 w-3" />
        )}
        Queue symbols
      </Button>
    </Card>
  );
};

export default AdminToolsPanel;
