import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { CoverageRow, GapRow, PackRow, QueueRow } from "@/hooks/useSoundLibrary";

/** Signal-weighted coverage per taxonomy branch: what we actually hear. */
export const CoverageMeter = ({ rows }: { rows: CoverageRow[] }) => (
  <div className="space-y-3">
    {rows.length === 0 && (
      <p className="text-sm text-muted-foreground">No observed tags yet.</p>
    )}
    {rows.map((r) => {
      const pct = Number(r.coverage_pct ?? 0);
      return (
        <div key={r.branch} className="space-y-1">
          <div className="flex items-baseline justify-between gap-2 text-sm">
            <span className="font-medium capitalize">{r.branch}</span>
            <span className="tabular-nums text-muted-foreground">
              {pct.toFixed(1)}% · {r.grounded_tags}/{r.observed_tags} tags
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-secondary/40">
            <div
              className="h-full rounded-full bg-primary transition-all"
              style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
            />
          </div>
        </div>
      );
    })}
  </div>
);

/** The tags your real signal needs most, with nothing behind them yet. */
export const GapList = ({
  gaps,
  onCurate,
}: {
  gaps: GapRow[];
  onCurate: (gap: GapRow) => void;
}) => (
  <div className="space-y-2">
    {gaps.length === 0 && (
      <p className="text-sm text-muted-foreground">
        No uncovered tags in this view — everything observed has sound behind it.
      </p>
    )}
    {gaps.map((g) => (
      <div
        key={g.node_id}
        className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border/60 bg-card/40 px-3 py-2"
      >
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{g.label ?? g.code}</p>
          <p className="truncate text-xs text-muted-foreground">
            {g.code} · {g.observed_sources} sources · weight {Number(g.observed_weight).toFixed(2)}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {g.queued && <Badge variant="secondary">queued</Badge>}
          <Button size="sm" variant="outline" onClick={() => onCurate(g)}>
            Add clip
          </Button>
        </div>
      </div>
    ))}
  </div>
);

/** Review lane: nothing gets grounded without a license and an attribution. */
export const QueuePanel = ({
  rows,
  busy,
  onApprove,
  onReject,
}: {
  rows: QueueRow[];
  busy: string | null;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
}) => (
  <div className="space-y-2">
    {rows.length === 0 && (
      <p className="text-sm text-muted-foreground">Nothing waiting for review.</p>
    )}
    {rows.map((r) => (
      <div key={r.id} className="space-y-2 rounded-md border border-border/60 bg-card/40 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">{r.origin}</Badge>
          <span className="text-sm font-medium">{r.title ?? r.taxonomy_code}</span>
          <span className="text-xs text-muted-foreground">{r.taxonomy_code}</span>
        </div>
        <p className="break-all text-xs text-muted-foreground">
          {r.source_url ?? r.storage_path}
        </p>
        <p className="text-xs">
          <span className="font-medium">{r.license}</span> · {r.attribution}
        </p>
        <div className="flex gap-2">
          <Button
            size="sm"
            disabled={busy === `approve:${r.id}`}
            onClick={() => onApprove(r.id)}
          >
            {busy === `approve:${r.id}` ? "Listening…" : "Approve & ground"}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={busy === `reject:${r.id}`}
            onClick={() => onReject(r.id)}
          >
            Reject
          </Button>
        </div>
      </div>
    ))}
  </div>
);

/** Versioned grounding packs — what the model is currently listening with. */
export const PackList = ({
  packs,
  busy,
  onActivate,
}: {
  packs: PackRow[];
  busy: string | null;
  onActivate: (id: string) => void;
}) => (
  <div className="space-y-2">
    {packs.map((p) => (
      <div
        key={p.id}
        className={cn(
          "flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2",
          p.is_active ? "border-primary/50 bg-primary/5" : "border-border/60 bg-card/40",
        )}
      >
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{p.name}</p>
          <p className="text-xs text-muted-foreground">
            {p.version} · {p.kind === "identity_stub" ? "identity stub" : `${p.code_count} codes`}
          </p>
        </div>
        {p.is_active ? (
          <Badge>active</Badge>
        ) : (
          <Button
            size="sm"
            variant="outline"
            disabled={busy === `activate:${p.id}`}
            onClick={() => onActivate(p.id)}
          >
            Activate
          </Button>
        )}
      </div>
    ))}
  </div>
);

/** Manual add form — the license fields are deliberately not optional. */
export const AddClipForm = ({
  code,
  onCancel,
  onSubmit,
}: {
  code: string;
  onCancel: () => void;
  onSubmit: (row: {
    taxonomy_code: string;
    source_url: string;
    title?: string;
    license: string;
    attribution: string;
  }) => Promise<void>;
}) => {
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [license, setLicense] = useState("CC0");
  const [attribution, setAttribution] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    setSaving(true);
    setErr(null);
    try {
      await onSubmit({
        taxonomy_code: code,
        source_url: url.trim(),
        title: title.trim() || undefined,
        license: license.trim(),
        attribution: attribution.trim(),
      });
      onCancel();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not queue that clip");
    } finally {
      setSaving(false);
    }
  };

  const ready = url.trim().length > 8 && license.trim() && attribution.trim();

  return (
    <Card className="space-y-3 p-4">
      <p className="text-sm font-medium">
        Queue a clip for <span className="text-primary">{code}</span>
      </p>
      <Input placeholder="Clip URL (openly licensed catalog)" value={url} onChange={(e) => setUrl(e.target.value)} />
      <Input placeholder="Title (optional)" value={title} onChange={(e) => setTitle(e.target.value)} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Input placeholder="License (e.g. CC0, CC-BY)" value={license} onChange={(e) => setLicense(e.target.value)} />
        <Input
          placeholder="Attribution (creator + source page)"
          value={attribution}
          onChange={(e) => setAttribution(e.target.value)}
        />
      </div>
      {err && <p className="text-xs text-destructive">{err}</p>}
      <div className="flex gap-2">
        <Button size="sm" disabled={!ready || saving} onClick={submit}>
          {saving ? "Queueing…" : "Add to review queue"}
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </Card>
  );
};
