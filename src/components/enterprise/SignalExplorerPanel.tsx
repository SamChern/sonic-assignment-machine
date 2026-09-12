/**
 * Admin-only drill-down over one data feed's device signals.
 *
 * Pick a family (CTV channel, CTV genre, web topic, demographics…), then a
 * value inside it, and see the individual devices that carry it together with
 * the six semantic scores SonicSIM appended. Everything comes from a bounded
 * sample of the feed's most recently touched rows — nothing is estimated.
 */
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, RefreshCw, Search, Telescope, ChevronLeft, ChevronRight } from "lucide-react";
import { useSignalExplorer } from "@/hooks/useSignalExplorer";

const fmt = (n: number) => n.toLocaleString();
const CATEGORIES = [
  "emotional",
  "cognitive",
  "social",
  "communication",
  "contextual",
  "artistic",
] as const;

export default function SignalExplorerPanel({
  organizationId,
}: {
  organizationId: string;
}) {
  const [feeds, setFeeds] = useState<{ activation_id: string; label: string | null }[]>([]);
  const [feed, setFeed] = useState("");

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { data } = await supabase
        .from("org_intuizi_activations")
        .select("activation_id, label")
        .eq("organization_id", organizationId)
        .eq("is_active", true)
        .order("activation_id");
      if (cancelled) return;
      const rows = (data ?? []) as { activation_id: string; label: string | null }[];
      setFeeds(rows);
      setFeed((prev) => prev || rows[0]?.activation_id || "");
    })();
    return () => {
      cancelled = true;
    };
  }, [organizationId]);

  const {
    data,
    family,
    chooseFamily,
    value,
    chooseValue,
    search,
    setSearch,
    page,
    setPage,
    pageSize,
    loading,
    error,
    reload,
  } = useSignalExplorer(feed);

  const pages = data ? Math.ceil(data.matched / pageSize) : 0;

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-center gap-2">
        <p className="flex items-center gap-2 text-sm font-semibold">
          <Telescope className="h-4 w-4 text-primary" />
          Explore the signals device by device
        </p>
        <Badge variant="outline" className="text-[11px]">
          admin only
        </Badge>
        <div className="ml-auto flex items-center gap-2">
          {feeds.length > 1 && (
            <Select value={feed} onValueChange={setFeed}>
              <SelectTrigger className="h-9 w-[180px]">
                <SelectValue placeholder="Data feed" />
              </SelectTrigger>
              <SelectContent>
                {feeds.map((f) => (
                  <SelectItem key={f.activation_id} value={f.activation_id}>
                    {f.label ? `${f.label} (#${f.activation_id})` : `Feed #${f.activation_id}`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Button variant="outline" size="sm" onClick={() => void reload()} disabled={loading}>
            {loading ? (
              <Loader2 className="mr-1 h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="mr-1 h-4 w-4" />
            )}
            Refresh
          </Button>
        </div>
      </div>

      <p className="mt-1 text-xs text-muted-foreground">
        Choose a channel, genre, topic or demographic group, then open it to see the devices behind
        it and the scores SonicSIM gave them.
      </p>

      {error && (
        <p className="mt-3 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-xs">
          {error}
        </p>
      )}

      {!feed && !loading && (
        <p className="mt-3 rounded-lg border border-border/60 bg-muted/20 p-3 text-xs text-muted-foreground">
          No data feed has been shared with this account yet.
        </p>
      )}

      {data && (
        <>
          <p className="mt-3 text-[11px] text-muted-foreground">
            {fmt(data.sampled_devices)} devices in this sample of {fmt(data.sample_size)} feed rows
          </p>

          <div className="mt-2 flex flex-wrap gap-1.5">
            {data.families.map((f) => (
              <button
                key={f.family}
                type="button"
                onClick={() => chooseFamily(f.family === family ? null : f.family)}
                className={`rounded-full border px-2.5 py-1 text-[11px] transition-colors ${
                  f.family === family
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border/60 bg-muted/20 hover:bg-muted/40"
                }`}
              >
                {f.family} · {fmt(f.devices)}
              </button>
            ))}
            {!data.families.length && (
              <span className="text-xs text-muted-foreground">
                No signal values have landed for this feed yet.
              </span>
            )}
          </div>

          {family && (
            <div className="mt-4 rounded-lg border border-border/60 bg-muted/20 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-xs font-medium">{family}</p>
                <div className="relative ml-auto w-full sm:w-56">
                  <Search className="absolute left-2 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                  <Input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder={`Search ${family.toLowerCase()}`}
                    className="h-8 pl-7 text-xs"
                  />
                </div>
              </div>
              <div className="mt-2 max-h-56 space-y-1 overflow-y-auto">
                {data.values.map((v) => (
                  <button
                    key={v.value}
                    type="button"
                    onClick={() => chooseValue(v.value === value ? null : v.value)}
                    className={`flex w-full items-center justify-between gap-2 rounded-md border px-2 py-1.5 text-left text-xs transition-colors ${
                      v.value === value
                        ? "border-primary bg-primary/10"
                        : "border-transparent hover:bg-muted/40"
                    }`}
                  >
                    <span className="truncate">{v.value}</span>
                    <span className="shrink-0 text-[11px] text-muted-foreground">
                      {fmt(v.devices)} · {v.share_pct}%
                    </span>
                  </button>
                ))}
                {!data.values.length && !loading && (
                  <p className="text-xs text-muted-foreground">Nothing matched that search.</p>
                )}
              </div>
            </div>
          )}

          {value && (
            <div className="mt-4">
              <p className="text-xs font-medium">
                {fmt(data.matched)} device{data.matched === 1 ? "" : "s"} in the sample carry “
                {value}”
              </p>
              <div className="mt-2 overflow-x-auto">
                <table className="w-full min-w-[640px] text-xs">
                  <thead className="text-[11px] text-muted-foreground">
                    <tr className="border-b border-border/60">
                      <th className="py-1.5 text-left font-medium">Device</th>
                      <th className="py-1.5 text-left font-medium">Grounding</th>
                      <th className="py-1.5 text-right font-medium">Confidence</th>
                      {CATEGORIES.map((c) => (
                        <th key={c} className="py-1.5 text-right font-medium capitalize">
                          {c.slice(0, 3)}
                        </th>
                      ))}
                      <th className="py-1.5 text-left font-medium">Other signals</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.devices.map((d) => (
                      <tr key={d.id} className="border-b border-border/40 align-top">
                        <td className="py-1.5 pr-2 font-mono text-[11px]">
                          {d.identifier.slice(0, 12)}…
                        </td>
                        <td className="py-1.5 pr-2">
                          <Badge
                            variant={d.grounding_level === "text-only" ? "outline" : "secondary"}
                            className="text-[10px]"
                          >
                            {d.grounding_level}
                          </Badge>
                        </td>
                        <td className="py-1.5 pr-2 text-right">
                          {d.confidence === null ? "—" : `${Math.round(Number(d.confidence) * 100)}%`}
                        </td>
                        {CATEGORIES.map((c) => (
                          <td key={c} className="py-1.5 pr-2 text-right">
                            {d.scores?.[c] === null || d.scores?.[c] === undefined
                              ? "—"
                              : Math.round(Number(d.scores[c]))}
                          </td>
                        ))}
                        <td className="py-1.5">
                          <div className="flex flex-wrap gap-1">
                            {(d.labels ?? [])
                              .filter((l) => l !== `${family}: ${value}`)
                              .slice(0, 4)
                              .map((l) => (
                                <Badge key={l} variant="outline" className="text-[10px]">
                                  {l}
                                </Badge>
                              ))}
                          </div>
                        </td>
                      </tr>
                    ))}
                    {!data.devices.length && !loading && (
                      <tr>
                        <td colSpan={10} className="py-3 text-center text-muted-foreground">
                          No devices on this page.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              {pages > 1 && (
                <div className="mt-2 flex items-center justify-end gap-2 text-xs">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page === 0 || loading}
                    onClick={() => setPage(Math.max(0, page - 1))}
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <span className="text-muted-foreground">
                    Page {page + 1} of {pages}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page + 1 >= pages || loading}
                    onClick={() => setPage(page + 1)}
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              )}
            </div>
          )}

          {!value && family && (
            <p className="mt-2 text-[11px] text-muted-foreground">
              Pick one {family.toLowerCase()} above to list its devices.
            </p>
          )}
        </>
      )}
    </Card>
  );
}
