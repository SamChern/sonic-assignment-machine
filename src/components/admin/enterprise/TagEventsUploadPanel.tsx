/**
 * Admin: upload your own site tag events for one enterprise account and see
 * how they feed the Enrichment confidence numbers.
 *
 * Accepts a CSV file (or pasted CSV) with the columns the tag itself sends:
 *   external_user_id, kpi_metric, kpi_value, occurred_at (optional),
 *   event_name (optional), page_url (optional)
 */
import { useMemo, useRef, useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Upload } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

const TEMPLATE =
  "external_user_id,kpi_metric,kpi_value,occurred_at,event_name,page_url\n" +
  "device-0001,site_visit,1,2026-09-01T12:00:00Z,page_view,https://example.com/\n" +
  "device-0002,lead_form,1,2026-09-01T13:20:00Z,conversion,https://example.com/contact\n";

interface ParsedRow {
  external_user_id: string;
  kpi_metric: string;
  kpi_value: string;
  occurred_at?: string;
  event_name?: string;
  page_url?: string;
}

interface ImportResult {
  inserted: number;
  skipped: string[];
  devices: number;
  matched_devices: number;
  scored_devices: number;
  min_rows_for_impact: number;
  impact_ready: boolean;
  metrics: { kpi_metric: string; events: number; devices: number; avg_value: number }[];
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out.map((v) => v.trim());
}

function parseCsv(text: string): { rows: ParsedRow[]; problems: string[] } {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length < 2) return { rows: [], problems: ["Needs a header row and at least one event."] };

  const header = splitCsvLine(lines[0]).map((h) => h.toLowerCase());
  const required = ["external_user_id", "kpi_metric", "kpi_value"];
  const problems: string[] = [];
  for (const col of required) {
    if (!header.includes(col)) problems.push(`Missing column: ${col}`);
  }
  if (problems.length) return { rows: [], problems };

  const idx = (name: string) => header.indexOf(name);
  const rows: ParsedRow[] = [];
  lines.slice(1).forEach((line, i) => {
    const cells = splitCsvLine(line);
    const pick = (name: string) => {
      const at = idx(name);
      return at >= 0 ? (cells[at] ?? "") : "";
    };
    const row: ParsedRow = {
      external_user_id: pick("external_user_id"),
      kpi_metric: pick("kpi_metric"),
      kpi_value: pick("kpi_value"),
      occurred_at: pick("occurred_at") || undefined,
      event_name: pick("event_name") || undefined,
      page_url: pick("page_url") || undefined,
    };
    if (!row.external_user_id || !row.kpi_metric) {
      problems.push(`Line ${i + 2}: needs a device id and a tag name.`);
      return;
    }
    if (!Number.isFinite(Number(row.kpi_value))) {
      problems.push(`Line ${i + 2}: value "${row.kpi_value}" is not a number.`);
      return;
    }
    rows.push(row);
  });
  return { rows, problems };
}

const Metric = ({ label, value, hint }: { label: string; value: string; hint?: string }) => (
  <div className="rounded-lg border border-border/60 bg-muted/20 p-3">
    <p className="text-xs text-muted-foreground">{label}</p>
    <p className="text-lg font-semibold">{value}</p>
    {hint && <p className="mt-1 text-[11px] text-muted-foreground">{hint}</p>}
  </div>
);

export default function TagEventsUploadPanel({
  organizationId,
  orgName,
}: {
  organizationId: string;
  orgName?: string;
}) {
  const [text, setText] = useState("");
  const [tagId, setTagId] = useState("manual-upload");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const parsed = useMemo(() => (text.trim() ? parseCsv(text) : { rows: [], problems: [] }), [text]);

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      toast.error("That file is larger than 5 MB — split it into smaller batches.");
      return;
    }
    setText(await file.text());
    setResult(null);
  };

  const upload = async () => {
    if (!parsed.rows.length) return;
    setBusy(true);
    setResult(null);
    try {
      const { data, error } = await supabase.functions.invoke("admin-tag-events-import", {
        body: {
          organization_id: organizationId,
          tag_id: tagId.trim() || "manual-upload",
          tag_name: `Manual upload${orgName ? ` — ${orgName}` : ""}`,
          rows: parsed.rows.slice(0, 5000),
        },
      });
      if (error) throw error;
      if ((data as { error?: unknown })?.error) {
        throw new Error(
          typeof (data as { error?: unknown }).error === "string"
            ? String((data as { error?: string }).error)
            : "Some rows could not be read.",
        );
      }
      setResult(data as ImportResult);
      toast.success(`Added ${(data as ImportResult).inserted.toLocaleString()} events.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold">Your own site tag events</h3>
          <p className="text-xs text-muted-foreground">
            Load a CSV of measured events for {orgName ?? "this account"}. Matched devices are what
            the Enrichment confidence and predicted tag impact are built from.
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setText(TEMPLATE);
            setResult(null);
          }}
        >
          Use example
        </Button>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor="tag-events-file" className="text-xs">
            CSV file
          </Label>
          <Input
            id="tag-events-file"
            ref={fileRef}
            type="file"
            accept=".csv,text/csv,text/plain"
            className="mt-1"
            onChange={(e) => onFile(e.target.files?.[0])}
          />
        </div>
        <div>
          <Label htmlFor="tag-events-tag" className="text-xs">
            Tag name
          </Label>
          <Input
            id="tag-events-tag"
            className="mt-1"
            value={tagId}
            onChange={(e) => setTagId(e.target.value)}
            placeholder="manual-upload"
          />
        </div>
      </div>

      <div className="mt-3">
        <Label htmlFor="tag-events-text" className="text-xs">
          Or paste rows
        </Label>
        <Textarea
          id="tag-events-text"
          className="mt-1 min-h-[120px] font-mono text-xs"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setResult(null);
          }}
          placeholder={TEMPLATE}
        />
        <p className="mt-1 text-[11px] text-muted-foreground">
          Columns: external_user_id, kpi_metric, kpi_value, and optionally occurred_at, event_name,
          page_url. Up to 5,000 rows at a time.
        </p>
      </div>

      {parsed.problems.length > 0 && (
        <div className="mt-3 rounded-lg border border-destructive/40 bg-destructive/5 p-3">
          <p className="text-xs font-medium text-destructive">
            {parsed.problems.length} row{parsed.problems.length === 1 ? "" : "s"} will be left out
          </p>
          <ul className="mt-1 space-y-0.5 text-[11px] text-muted-foreground">
            {parsed.problems.slice(0, 5).map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button onClick={upload} disabled={busy || parsed.rows.length === 0} size="sm">
          {busy ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <Upload className="mr-2 h-4 w-4" aria-hidden="true" />
          )}
          Add {parsed.rows.length.toLocaleString()} events
        </Button>
        {parsed.rows.length > 0 && (
          <span className="text-xs text-muted-foreground">
            {new Set(parsed.rows.map((r) => r.kpi_metric)).size} tag name(s),{" "}
            {new Set(parsed.rows.map((r) => r.external_user_id)).size} device(s)
          </span>
        )}
      </div>

      {result && (
        <div className="mt-4 space-y-3 border-t border-border/60 pt-4">
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <Metric label="Events added" value={result.inserted.toLocaleString()} />
            <Metric label="Devices in file" value={result.devices.toLocaleString()} />
            <Metric
              label="Devices this account holds"
              value={result.matched_devices.toLocaleString()}
              hint="Found in this account's own rows"
            />
            <Metric
              label="Matched and scored"
              value={result.scored_devices.toLocaleString()}
              hint={`${result.min_rows_for_impact} needed for an impact estimate`}
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={result.impact_ready ? "default" : "outline"} className="text-[10px]">
              {result.impact_ready ? "Enough data for impact estimates" : "Not enough matched data yet"}
            </Badge>
            {result.skipped.length > 0 && (
              <span className="text-[11px] text-muted-foreground">
                {result.skipped.length} row(s) skipped
              </span>
            )}
          </div>

          {result.metrics.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[420px] text-xs">
                <thead className="text-muted-foreground">
                  <tr className="border-b border-border/60 text-left">
                    <th className="py-1.5 pr-3 font-medium">Tag</th>
                    <th className="py-1.5 pr-3 font-medium">Events</th>
                    <th className="py-1.5 pr-3 font-medium">Devices</th>
                    <th className="py-1.5 font-medium">Average value</th>
                  </tr>
                </thead>
                <tbody>
                  {result.metrics.map((m) => (
                    <tr key={m.kpi_metric} className="border-b border-border/40">
                      <td className="py-1.5 pr-3">{m.kpi_metric}</td>
                      <td className="py-1.5 pr-3">{m.events.toLocaleString()}</td>
                      <td className="py-1.5 pr-3">{m.devices.toLocaleString()}</td>
                      <td className="py-1.5">{m.avg_value.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <p className="text-[11px] text-muted-foreground">
            The Enrichment tab reads these events directly — reopen it to see the updated confidence
            and predicted tag impact.
          </p>
        </div>
      )}
    </Card>
  );
}
