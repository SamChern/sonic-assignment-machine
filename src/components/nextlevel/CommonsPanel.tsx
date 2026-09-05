import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { friendlyError } from "@/lib/friendlyError";

interface PoolItem {
  id: string;
  title: string | null;
  rights_holder: string | null;
  status: string;
  included_at: string | null;
}

interface Ledger {
  id: string;
  pool_item_id: string | null;
  license: string | null;
  rights_holder: string | null;
  attribution: string | null;
  verified_at: string | null;
}

interface Payout {
  id: string;
  pool_item_id: string | null;
  period_start: string;
  period_end: string;
  inclusions: number | null;
  amount_usd: number | null;
}

/**
 * Sonic Commons (item 2): a governed, rights-cleared pool over the creator
 * corpus — inclusion governance, a license ledger, and per-inclusion payout
 * records. Admin door only; creators never see anyone else's terms.
 */
export function CommonsPanel() {
  const [items, setItems] = useState<PoolItem[]>([]);
  const [ledger, setLedger] = useState<Ledger[]>([]);
  const [payouts, setPayouts] = useState<Payout[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const [a, b, c] = await Promise.all([
        supabase
          .from("commons_pool_items")
          .select("id, title, rights_holder, status, included_at")
          .order("created_at", { ascending: false })
          .limit(50),
        supabase
          .from("commons_license_ledger")
          .select("id, pool_item_id, license, rights_holder, attribution, verified_at")
          .order("created_at", { ascending: false })
          .limit(50),
        supabase
          .from("commons_payouts")
          .select("id, pool_item_id, period_start, period_end, inclusions, amount_usd")
          .order("period_start", { ascending: false })
          .limit(50),
      ]);
      setItems(a.data ?? []);
      setLedger(b.data ?? []);
      setPayouts(c.data ?? []);
    } catch (err) {
      toast({ title: "Couldn't load the pool", description: friendlyError(err), variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const setStatus = async (id: string, status: string) => {
    const { error } = await supabase
      .from("commons_pool_items")
      .update({ status, included_at: status === "included" ? new Date().toISOString() : null })
      .eq("id", id);
    if (error) {
      toast({ title: "Couldn't update", description: friendlyError(error), variant: "destructive" });
      return;
    }
    await load();
  };

  const totalPaid = payouts.reduce((sum, p) => sum + Number(p.amount_usd ?? 0), 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Sonic Commons</CardTitle>
        <CardDescription>
          A shared pool of sound that only ever includes work with clear rights, a recorded licence,
          credit for whoever made it, and a record of what each inclusion earned.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="flex flex-wrap gap-2">
          <Badge variant="secondary">{items.length} works considered</Badge>
          <Badge variant="outline">
            {items.filter((i) => i.status === "included").length} included
          </Badge>
          <Badge variant="outline">{ledger.length} licence records</Badge>
          <Badge variant="outline">${totalPaid.toFixed(2)} recorded in payouts</Badge>
        </div>

        {loading && <p className="text-sm text-muted-foreground">Loading…</p>}
        {!loading && items.length === 0 && (
          <p className="text-sm text-muted-foreground">
            Nothing has been proposed for the pool yet. Works enter from the creator catalogue once a
            rights holder opts in.
          </p>
        )}

        <div className="space-y-2">
          {items.map((item) => {
            const licence = ledger.find((l) => l.pool_item_id === item.id);
            return (
              <div key={item.id} className="rounded-md border p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">{item.title ?? "Untitled work"}</span>
                  <Badge variant={item.status === "included" ? "secondary" : "outline"}>
                    {item.status}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground">
                  {item.rights_holder ?? "Rights holder not recorded"}
                  {licence?.license ? ` · ${licence.license}` : " · no licence on file"}
                  {licence?.attribution ? ` · credit: ${licence.attribution}` : ""}
                </p>
                <div className="mt-2 flex gap-2">
                  {item.status !== "included" && licence?.license && (
                    <Button size="sm" variant="outline" onClick={() => setStatus(item.id, "included")}>
                      Include
                    </Button>
                  )}
                  {item.status === "included" && (
                    <Button size="sm" variant="ghost" onClick={() => setStatus(item.id, "withdrawn")}>
                      Withdraw
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
