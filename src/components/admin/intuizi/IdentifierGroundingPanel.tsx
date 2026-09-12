/**
 * Grounded vs text-only scores, device by device.
 *
 * "Grounded" means real audio was analysed behind the scores, "carried over"
 * means an audio vector was bridged from a related source, and "text-only"
 * means the scores came from the audience tags alone. Operators can pick a
 * batch and send it back through scoring.
 */
import { useMemo } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertTriangle,
  Loader2,
  RefreshCw,
  RotateCcw,
  Sparkles,
  Waves,
} from "lucide-react";
import useIdentifierGrounding, {
  type GroundingFilter,
  type IdentifierRow,
} from "./useIdentifierGrounding";

const CATEGORIES = [
  "emotional",
  "cognitive",
  "social",
  "communication",
  "contextual",
  "artistic",
] as const;

const LEVEL_LABEL: Record<string, string> = {
  grounded: "Grounded in audio",
  bridged: "Carried over",
  "text-only": "Text-only",
};

const LEVEL_STYLE: Record<string, string> = {
  grounded: "bg-emerald-500/15 text-emerald-500 border-emerald-500/30",
  bridged: "bg-sky-500/15 text-sky-500 border-sky-500/30",
  "text-only": "bg-muted text-muted-foreground border-border",
};

const fmt = (n: number) => n.toLocaleString();
const levelKey = (l: string) => (l === "grounded" || l === "bridged" ? l : "text-only");

const Stat = ({ label, value, hint }: { label: string; value: string; hint?: string }) => (
  <div className="rounded-lg border border-border bg-card/60 p-3">
    <p className="text-xs text-muted-foreground">{label}</p>
    <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
    {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
  </div>
);

const ScoreStrip = ({ scores }: { scores: IdentifierRow["scores"] }) => {
  if (!scores) return <span className="text-[11px] text-muted-foreground">No scores yet</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {CATEGORIES.map((c) => {
        const v = scores[c];
        return (
          <span
            key={c}
            className="rounded border border-border bg-background px-1.5 py-0.5 text-[11px] tabular-nums"
            title={c}
          >
            {c.slice(0, 3)} {v === null || v === undefined ? "—" : Math.round(Number(v))}
          </span>
        );
      })}
    </div>
  );
};

const Row = ({
  row,
  checked,
  onToggle,
}: {
  row: IdentifierRow;
  checked: boolean;
  onToggle: () => void;
}) => {
  const key = levelKey(row.grounding_level);
  return (
    <li className="border-b border-border/60 py-3 last:border-0">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <Checkbox
          checked={checked}
          onCheckedChange={onToggle}
          aria-label={`Select device ${row.identifier}`}
        />
        <Badge variant="outline" className={LEVEL_STYLE[key]}>
          {LEVEL_LABEL[key]}
        </Badge>
        <span className="max-w-[13rem] truncate font-mono" title={row.identifier}>
          {row.identifier}
        </span>
        {row.activation_id && (
          <span className="text-muted-foreground">feed {row.activation_id}</span>
        )}
        <span className="text-muted-foreground">· {row.status.replace("_", " ")}</span>
        {row.confidence !== null && row.confidence !== undefined && (
          <span className="text-muted-foreground">
            · {Math.round(Number(row.confidence) * 100)}% confidence
          </span>
        )}
        {row.has_audio_embedding && (
          <span className="inline-flex items-center gap-1 text-emerald-500">
            <Waves className="h-3 w-3" aria-hidden="true" /> audio vector
          </span>
        )}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2 pl-6">
        <ScoreStrip scores={row.scores} />
        {!!row.tag_labels?.length && (
          <span className="max-w-full truncate text-[11px] text-muted-foreground">
            {row.tag_labels.slice(0, 3).join(" · ")}
            {row.tag_labels.length > 3 ? ` +${row.tag_labels.length - 3}` : ""}
          </span>
        )}
      </div>
      {row.last_error && (
        <p className="mt-1 pl-6 text-[11px] text-destructive" title={row.last_error}>
          {row.last_error}
        </p>
      )}
    </li>
  );
};

export const IdentifierGroundingPanel = () => {
  const s = useIdentifierGrounding();
  const sum = s.summary;

  const share = useMemo(() => {
    if (!sum?.sampled) return null;
    const g = sum.grounded + sum.bridged;
    return {
      grounded: `${((g / sum.sampled) * 100).toFixed(1)}%`,
      text: `${((sum.text_only / sum.sampled) * 100).toFixed(1)}%`,
    };
  }, [sum]);

  const allOnPage = s.rows.length > 0 && s.rows.every((r) => s.selected.includes(r.id));

  return (
    <Card className="space-y-5 p-5">
      <div className="flex flex-wrap items-center gap-3">
        <Sparkles className="h-5 w-5 text-primary" aria-hidden="true" />
        <h2 className="text-base font-semibold">Grounded vs text-only, device by device</h2>
        <Button
          variant="outline"
          size="sm"
          className="ml-auto"
          onClick={s.reload}
          disabled={s.loading}
        >
          {s.loading ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" />
          )}
          Refresh
        </Button>
      </div>

      <p className="text-sm text-muted-foreground">
        Reads the most recently touched devices in the scoring queue and shows whether their six
        scores came from real audio or from audience tags alone. Pick any of them and send them back
        through scoring.
      </p>

      {sum && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Devices in this sample" value={fmt(sum.sampled)} />
          <Stat
            label="Grounded in audio"
            value={fmt(sum.grounded + sum.bridged)}
            hint={share ? `${share.grounded} of the sample` : undefined}
          />
          <Stat
            label="Text-only"
            value={fmt(sum.text_only)}
            hint={share ? `${share.text} of the sample` : undefined}
          />
          <Stat
            label="Average confidence"
            value={
              sum.avg_confidence === null || sum.avg_confidence === undefined
                ? "—"
                : `${Math.round(Number(sum.avg_confidence) * 100)}%`
            }
            hint={`${fmt(sum.with_audio)} with an audio vector`}
          />
        </div>
      )}

      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[10rem] flex-1">
          <label className="text-xs text-muted-foreground" htmlFor="grounding-feed">
            Data feed (optional)
          </label>
          <Input
            id="grounding-feed"
            value={s.activationId}
            onChange={(e) => s.setActivationId(e.target.value)}
            placeholder="e.g. 5581"
            className="mt-1"
          />
        </div>
        <div className="min-w-[11rem]">
          <label className="text-xs text-muted-foreground" htmlFor="grounding-filter">
            Show
          </label>
          <Select
            value={s.filter}
            onValueChange={(v) => s.setFilter(v as GroundingFilter)}
          >
            <SelectTrigger id="grounding-filter" className="mt-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Everything</SelectItem>
              <SelectItem value="grounded">Grounded in audio</SelectItem>
              <SelectItem value="bridged">Carried over</SelectItem>
              <SelectItem value="text-only">Text-only</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {s.error && (
        <p className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          {s.error}
        </p>
      )}
      {s.note && <p className="text-sm text-primary">{s.note}</p>}

      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/30 p-3">
        <Checkbox
          checked={allOnPage}
          onCheckedChange={(v) => s.selectPage(!!v)}
          aria-label="Select every device on this page"
          id="select-page"
        />
        <label htmlFor="select-page" className="text-xs text-muted-foreground">
          Select this page
        </label>
        <span className="text-xs text-muted-foreground">
          {s.selected.length ? `${fmt(s.selected.length)} selected` : "Nothing selected"}
        </span>
        <div className="ml-auto flex flex-wrap gap-2">
          <Button
            size="sm"
            onClick={() => s.rescore(false)}
            disabled={!s.selected.length || s.busy}
          >
            {s.busy ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <RotateCcw className="mr-2 h-4 w-4" aria-hidden="true" />
            )}
            Re-score selected
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => s.rescore(true)}
            disabled={!s.selected.length || s.busy}
          >
            Re-score from scratch
          </Button>
        </div>
      </div>

      {s.loading && !s.rows.length ? (
        <p className="text-sm text-muted-foreground">Reading recent devices…</p>
      ) : s.rows.length ? (
        <ul>
          {s.rows.map((r) => (
            <Row
              key={r.id}
              row={r}
              checked={s.selected.includes(r.id)}
              onToggle={() => s.toggle(r.id)}
            />
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">
          No devices match this view. Try a different feed or show everything.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
        <span>
          Showing {fmt(s.page * s.pageSize + (s.rows.length ? 1 : 0))}–
          {fmt(s.page * s.pageSize + s.rows.length)} of {fmt(s.matched)} matching
        </span>
        <div className="ml-auto flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => s.setPage(Math.max(0, s.page - 1))}
            disabled={s.page === 0 || s.loading}
          >
            Previous
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => s.setPage(s.page + 1)}
            disabled={s.loading || (s.page + 1) * s.pageSize >= s.matched}
          >
            Next
          </Button>
        </div>
        {s.fetchedAt && <span>Updated {s.fetchedAt.toLocaleTimeString()}</span>}
      </div>
    </Card>
  );
};

export default IdentifierGroundingPanel;
