import { useCallback, useMemo, useRef, useState } from "react";
import {
  CheckCircle2,
  GitCompareArrows,
  Gauge,
  Loader2,
  RefreshCw,
  Sparkles,
  Upload,
  Waves,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  IntuiziCatalogTree,
  type CrosswalkDecision,
  type CrosswalkProposal,
} from "@/components/admin/IntuiziCatalogTree";
import {
  PREFIXES,
  treeFromCodes,
  type Coverage,
  type ListedNode,
} from "@/components/admin/audioSetCrosswalk";


/**
 * Step 5 — AudioSet ontology import, crosswalk proposal and human approval.
 * Admin-only; every call goes through admin-guarded edge functions.
 */
export const AudioSetCrosswalkPanel = () => {
  const fileRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [embedding, setEmbedding] = useState(false);
  const [proposing, setProposing] = useState(false);
  const [autoApproving, setAutoApproving] = useState(false);
  const [backfilling, setBackfilling] = useState(false);
  const [threshold, setThreshold] = useState(0.7);
  const [loadingList, setLoadingList] = useState(false);
  const [deciding, setDeciding] = useState<string | null>(null);
  const [prefix, setPrefix] = useState("iab.");
  const [pendingOnly, setPendingOnly] = useState(false);
  const [coverage, setCoverage] = useState<Coverage>({});
  const [nodes, setNodes] = useState<ListedNode[]>([]);
  const [log, setLog] = useState<string | null>(null);

  const call = useCallback(async (fn: string, body: Record<string, unknown>) => {
    const { data, error } = await supabase.functions.invoke(fn, { body });
    if (error) throw new Error(error.message);
    const payload = data as Record<string, unknown>;
    if (payload?.success === false) throw new Error(String(payload.error ?? "Request failed"));
    return payload;
  }, []);

  const mergeCoverage = (payload: Record<string, unknown>) =>
    setCoverage((prev) => ({
      ...prev,
      ...(payload as Coverage),
    }));

  const refresh = useCallback(async () => {
    setLoadingList(true);
    try {
      const [status, list] = await Promise.all([
        call("taxonomy-audioset-import", { status_only: true }),
        call("taxonomy-crosswalk", {
          action: "list",
          prefix: prefix === "all" ? undefined : prefix,
          pending_only: pendingOnly,
          limit: 400,
        }),
      ]);
      mergeCoverage(status);
      mergeCoverage(list);
      setNodes((list.nodes as ListedNode[]) ?? []);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load crosswalk");
    } finally {
      setLoadingList(false);
    }
  }, [call, prefix, pendingOnly]);

  const onImport = async (file: File) => {
    setImporting(true);
    setLog(null);
    try {
      const parsed = JSON.parse(await file.text());
      const res = await call("taxonomy-audioset-import", { ontology: parsed });
      mergeCoverage(res);
      setLog(
        `Imported ${res.inserted ?? 0} new / updated ${res.updated ?? 0} AudioSet nodes (${res.nodes ?? 0} parsed).`,
      );
      toast.success(`AudioSet ontology imported (${res.aset_nodes ?? 0} aset.* nodes)`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Import failed");
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const onEmbed = async () => {
    setEmbedding(true);
    try {
      const res = await call("semantic-backfill", { limit: 500 });
      const status = await call("taxonomy-audioset-import", { status_only: true });
      mergeCoverage(status);
      setLog(`Embedded ${res.embedded ?? 0} nodes (${res.failed ?? 0} failed).`);
      toast.success(`Embedded ${res.embedded ?? 0} taxonomy nodes`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Backfill failed");
    } finally {
      setEmbedding(false);
    }
  };

  const onPropose = async () => {
    setProposing(true);
    try {
      const res = await call("taxonomy-crosswalk", {
        action: "propose",
        prefix: prefix === "all" ? undefined : prefix,
        top_k: 3,
        limit: 500,
        recompute: true,
      });
      mergeCoverage(res);
      setLog(
        `Proposed mappings for ${res.proposed ?? 0} nodes · ${res.skipped_no_embedding ?? 0} skipped (no embedding).`,
      );
      await refresh();
      toast.success("Crosswalk proposals refreshed");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Proposal run failed");
    } finally {
      setProposing(false);
    }
  };

  /**
   * Step 5 gate closer: re-labels placeholder nodes, embeds anything missing an
   * audio-space vector, then proposes mappings for nodes that have none.
   */
  const onBackfill = async () => {
    setBackfilling(true);
    try {
      const res = await call("taxonomy-crosswalk", {
        action: "backfill",
        prefix: prefix === "all" ? undefined : prefix,
        top_k: 3,
        limit: 400,
      });
      mergeCoverage(res);
      setLog(
        `Backfill: relabeled ${res.relabeled ?? 0} · embedded ${res.embedded ?? 0} · ` +
          `proposed ${res.proposed ?? 0} of ${res.proposal_candidates ?? 0} · ` +
          `${res.skipped_no_embedding ?? 0} still unembedded (semantic service ${res.semantic_svc ?? "?"}).`,
      );
      await refresh();
      toast.success(`Backfill proposed ${res.proposed ?? 0} mappings`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Backfill failed");
    } finally {
      setBackfilling(false);
    }
  };

  const onAutoApprove = async () => {
    setAutoApproving(true);
    try {
      const res = await call("taxonomy-crosswalk", {
        action: "auto_approve",
        prefix: prefix === "all" ? undefined : prefix,
        threshold,
        limit: 1000,
      });
      mergeCoverage(res);
      setLog(
        `Auto-approved ${res.approved ?? 0} nodes at cosine >= ${threshold.toFixed(2)} · ` +
          `${res.below_threshold ?? 0} left for manual review.`,
      );
      await refresh();
      toast.success(`Auto-approved ${res.approved ?? 0} mappings`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Auto-approval failed");
    } finally {
      setAutoApproving(false);
    }
  };

  const onDecide = async (code: string, target: string, decision: CrosswalkDecision) => {
    setDeciding(code);
    try {
      const res = await call("taxonomy-crosswalk", {
        action: "decide",
        code,
        decision,
        targets: [target],
      });
      mergeCoverage(res);
      const matches = (res.matches as CrosswalkProposal[]) ?? [];
      setNodes((prev) =>
        prev.map((n) =>
          n.code === code
            ? { ...n, matches, approved: matches.some((m) => m.approved) }
            : n,
        ),
      );
      toast.success(`${decision === "approve" ? "Approved" : decision === "reject" ? "Rejected" : "Cleared"} ${target}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Decision failed");
    } finally {
      setDeciding(null);
    }
  };

  const roots = useMemo(() => treeFromCodes(nodes), [nodes]);
  const crosswalkMap = useMemo(() => {
    const map: Record<string, CrosswalkProposal[]> = {};
    for (const n of nodes) map[n.code] = n.matches;
    return map;
  }, [nodes]);

  const iab = coverage.by_prefix?.["iab."];
  const iabUnmapped = useMemo(
    () => nodes.filter((n) => n.code.startsWith("iab.") && !n.approved).length,
    [nodes],
  );
  const approvalPct = coverage.eligible_total
    ? Math.round(((coverage.approved_total ?? 0) / coverage.eligible_total) * 100)
    : 0;

  return (
    <Card className="space-y-4 p-4 sm:p-5">
      <div className="flex flex-wrap items-center gap-2">
        <Waves className="h-4 w-4 text-primary" />
        <h3 className="text-sm font-semibold">AudioSet ontology &amp; crosswalk</h3>
        <Badge variant="outline" className="text-[10px]">
          {coverage.aset_nodes ?? 0} aset.* nodes
        </Badge>
        <Badge variant="outline" className="text-[10px]">
          {coverage.aset_embedded ?? 0} embedded
        </Badge>
        {coverage.iab_fully_approved && (
          <Badge className="gap-1 text-[10px]" variant="secondary">
            <CheckCircle2 className="h-3 w-3" /> IAB fully approved
          </Badge>
        )}
        <Button
          size="sm"
          variant="ghost"
          className="ml-auto h-7 text-[11px]"
          onClick={() => void refresh()}
          disabled={loadingList}
        >
          {loadingList ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <RefreshCw className="mr-1 h-3 w-3" />}
          Refresh
        </Button>
      </div>

      <p className="text-[11px] leading-relaxed text-muted-foreground">
        Import <code className="font-mono">ontology.json</code> from the AudioSet ontology repo, embed the
        nodes in the sonic space, then review the top-3 proposed mappings for every ingest vocabulary and
        approve the ones that hold up.
      </p>

      <div className="grid gap-2 sm:grid-cols-3">
        <div className="space-y-1">
          <Label className="text-[11px]">1 · Import ontology.json</Label>
          <input
            ref={fileRef}
            type="file"
            accept=".json,application/json"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void onImport(f);
            }}
          />
          <Button
            size="sm"
            variant="outline"
            className="w-full text-[11px]"
            disabled={importing}
            onClick={() => fileRef.current?.click()}
          >
            {importing ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Upload className="mr-1 h-3 w-3" />}
            Choose file
          </Button>
        </div>

        <div className="space-y-1">
          <Label className="text-[11px]">
            2 · Embed nodes {coverage.aset_pending_embedding ? `(${coverage.aset_pending_embedding} pending)` : ""}
          </Label>
          <Button
            size="sm"
            variant="outline"
            className="w-full text-[11px]"
            disabled={embedding}
            onClick={() => void onEmbed()}
          >
            {embedding ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Waves className="mr-1 h-3 w-3" />}
            Run semantic backfill
          </Button>
        </div>

        <div className="space-y-1">
          <Label className="text-[11px]">3 · Propose crosswalk (top 3)</Label>
          <Button
            size="sm"
            variant="outline"
            className="w-full text-[11px]"
            disabled={proposing}
            onClick={() => void onPropose()}
          >
            {proposing
              ? <Loader2 className="mr-1 h-3 w-3 animate-spin" />
              : <GitCompareArrows className="mr-1 h-3 w-3" />}
            Propose mappings
          </Button>
        </div>
      </div>

      <div className="space-y-2 rounded-md border border-border/60 bg-muted/30 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <Gauge className="h-3.5 w-3.5 text-primary" />
          <Label className="text-[11px] font-medium">4 · Auto-approve above similarity</Label>
          <Badge variant="outline" className="ml-auto font-mono text-[10px]">
            {threshold.toFixed(2)}
          </Badge>
        </div>
        <Slider
          value={[threshold]}
          min={0.5}
          max={0.95}
          step={0.01}
          onValueChange={([v]) => setThreshold(v)}
          aria-label="Auto-approval similarity threshold"
        />
        <p className="text-[10px] leading-relaxed text-muted-foreground">
          Approves the single best proposal per node when it clears the threshold. Nodes you already
          approved or rejected by hand are never touched, and weaker matches stay in the review queue below.
        </p>
        <Button
          size="sm"
          variant="outline"
          className="w-full text-[11px]"
          disabled={autoApproving}
          onClick={() => void onAutoApprove()}
        >
          {autoApproving
            ? <Loader2 className="mr-1 h-3 w-3 animate-spin" />
            : <CheckCircle2 className="mr-1 h-3 w-3" />}
          Auto-approve {prefix === "all" ? "all vocabularies" : prefix + "*"}
        </Button>
      </div>

      <div className="space-y-2 rounded-md border border-border/60 bg-muted/20 p-3">
        <div className="flex flex-wrap items-center gap-2 text-[11px]">
          <span className="font-medium">Step 5 gate</span>
          <Badge
            variant={coverage.iab_fully_approved ? "secondary" : "outline"}
            className={`text-[10px] ${coverage.iab_fully_approved ? "" : "text-amber-500"}`}
          >
            iab.*: {iab?.approved ?? 0}/{iab?.total ?? 0} with an approved mapping
          </Badge>
          {iabUnmapped > 0 && (
            <Badge variant="outline" className="text-[10px] text-muted-foreground">
              {iabUnmapped} unmapped in view
            </Badge>
          )}
          <Button
            size="sm"
            variant="outline"
            className="ml-auto h-7 text-[11px]"
            disabled={backfilling}
            onClick={() => void onBackfill()}
          >
            {backfilling
              ? <Loader2 className="mr-1 h-3 w-3 animate-spin" />
              : <Sparkles className="mr-1 h-3 w-3" />}
            Backfill + propose
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
          <span>
            {coverage.approved_total ?? 0} / {coverage.eligible_total ?? 0} nodes approved
          </span>
          {iab && (
            <span>· iab.* proposed on {iab.proposed}</span>
          )}
        </div>
        <Progress value={approvalPct} className="h-1.5" />
        <p className="text-[10px] leading-relaxed text-muted-foreground">
          Backfill resolves placeholder labels (e.g. “IAB category IAB7”), embeds any node missing a
          sonic vector, and proposes mappings for nodes that have none. Existing approvals are never
          overwritten, so running it twice is safe.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={prefix}
          onValueChange={(v) => {
            setPrefix(v);
            setNodes([]);
          }}
        >
          <SelectTrigger className="h-8 w-52 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PREFIXES.map((p) => (
              <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="flex items-center gap-1.5">
          <Switch
            id="crosswalk-pending"
            checked={pendingOnly}
            onCheckedChange={setPendingOnly}
          />
          <Label htmlFor="crosswalk-pending" className="text-[11px]">Needs approval only</Label>
        </div>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 text-[11px]"
          onClick={() => void refresh()}
          disabled={loadingList}
        >
          Load nodes
        </Button>
      </div>

      <IntuiziCatalogTree
        roots={roots}
        crosswalk={crosswalkMap}
        onDecide={(code, target, decision) => void onDecide(code, target, decision)}
        decidingCode={deciding}
        emptyHint="No nodes loaded — pick a vocabulary and hit “Load nodes”."
      />

      {log && <p className="text-[11px] text-muted-foreground">{log}</p>}
    </Card>
  );
};

export default AudioSetCrosswalkPanel;
