import { useCallback, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "@/hooks/use-toast";
import {
  AlertTriangle,
  CheckCircle2,
  KeyRound,
  Loader2,
  Play,
  ScanSearch,
  ShieldQuestion,
} from "lucide-react";

const REPORT_TYPES = ["ctv", "apps", "visitation", "demographics", "origin"] as const;

interface ValidatedKey {
  object_key: string;
  ok: boolean;
  size: number;
  content_type?: string;
  last_modified?: string | null;
  is_audio: boolean;
  report_type: string | null;
  needs_report_type: boolean;
  already_ingested: boolean;
  prior_status: string | null;
  error: string | null;
}

interface IngestOutcome {
  object_key: string;
  ok: boolean;
  detail: string;
  rosterOnly: boolean;
}

interface PrefixProbe {
  prefix: string;
  list_ok: boolean;
  objects_seen: number;
  error: string | null;
}

const bytes = (n: number) =>
  n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`;

const fileName = (key: string) => key.split("/").pop() ?? key;

const invokeIngest = async (body: Record<string, unknown>) => {
  const { data, error } = await supabase.functions.invoke("intuizi-ingest", { body });
  if (error) {
    const detail =
      "context" in error && error.context
        ? await (error.context as Response).text().catch(() => error.message)
        : error.message;
    throw new Error(detail);
  }
  return data as Record<string, unknown>;
};

/**
 * Manual-key ingestion fallback for when `s3:ListBucket` is unavailable, so
 * auto-discovery cannot see new deliveries. Paste the exact object keys (or a
 * manifest), validate them with HeadObject, then ingest the ones that pass.
 */
const IngestByKeyPanel = () => {
  const [raw, setRaw] = useState("");
  const [expandManifest, setExpandManifest] = useState(true);
  const [overrideType, setOverrideType] = useState<string>("auto");
  const [validating, setValidating] = useState(false);
  const [probing, setProbing] = useState(false);
  const [ingesting, setIngesting] = useState(false);
  const [keys, setKeys] = useState<ValidatedKey[] | null>(null);
  const [manifestNotes, setManifestNotes] = useState<string[]>([]);
  const [chosen, setChosen] = useState<Record<string, boolean>>({});
  const [outcomes, setOutcomes] = useState<IngestOutcome[]>([]);
  const [probe, setProbe] = useState<{ mode: string; prefixes: PrefixProbe[] } | null>(null);

  const probeAccess = useCallback(async () => {
    setProbing(true);
    try {
      const data = await invokeIngest({ action: "probe_access" });
      setProbe({
        mode: String(data.mode ?? "unknown"),
        prefixes: (data.prefixes ?? []) as PrefixProbe[],
      });
    } catch (e) {
      toast({ title: "Access probe failed", description: (e as Error).message, variant: "destructive" });
    } finally {
      setProbing(false);
    }
  }, []);

  const validate = useCallback(async () => {
    const object_keys = raw
      .split(/[\n\r]+/)
      .map((l) => l.trim())
      .filter(Boolean);
    if (!object_keys.length) {
      toast({ title: "Paste at least one S3 key", variant: "destructive" });
      return;
    }
    setValidating(true);
    setOutcomes([]);
    try {
      const data = await invokeIngest({
        action: "validate_keys",
        object_keys,
        expand_manifest: expandManifest,
      });
      const list = (data.keys ?? []) as ValidatedKey[];
      setKeys(list);
      setManifestNotes((data.manifest_notes ?? []) as string[]);
      setChosen(
        Object.fromEntries(list.map((k) => [k.object_key, k.ok && !k.already_ingested])),
      );
    } catch (e) {
      toast({ title: "Validation failed", description: (e as Error).message, variant: "destructive" });
    } finally {
      setValidating(false);
    }
  }, [raw, expandManifest]);

  const ingest = useCallback(async () => {
    const targets = (keys ?? []).filter((k) => chosen[k.object_key] && k.ok);
    if (!targets.length) {
      toast({ title: "Nothing selected", description: "Select at least one readable object." });
      return;
    }
    setIngesting(true);
    setOutcomes([]);
    const results: IngestOutcome[] = [];
    for (const k of targets) {
      const reportType =
        overrideType !== "auto" ? overrideType : (k.report_type ?? undefined);
      if (!k.is_audio && !reportType) {
        results.push({
          object_key: k.object_key,
          ok: false,
          detail: "report type could not be inferred — pick one above and retry",
          rosterOnly: false,
        });
        setOutcomes([...results]);
        continue;
      }
      try {
        const data = await invokeIngest({
          object_key: k.object_key,
          ...(k.is_audio ? {} : { report_type: reportType }),
        });
        const rowsRead = Number(data.rows_read ?? 0);
        const scored = Number(data.identifiers_scored ?? 0);
        const roster = Number(data.roster_identifiers ?? 0);
        const rosterOnly = Boolean(data.roster_only) || (roster > 0 && scored === 0);
        results.push({
          object_key: k.object_key,
          ok: !data.error,
          rosterOnly,
          detail: data.error
            ? String(data.error)
            : `${rowsRead} rows · ${scored} scored · ${roster} roster identifier(s)`,
        });
      } catch (e) {
        results.push({
          object_key: k.object_key,
          ok: false,
          rosterOnly: false,
          detail: (e as Error).message,
        });
      }
      setOutcomes([...results]);
    }
    setIngesting(false);
    const failed = results.filter((r) => !r.ok).length;
    toast({
      title: failed ? `Ingested with ${failed} failure(s)` : "Ingest complete",
      description: `${results.length - failed}/${results.length} object(s) processed.`,
      variant: failed ? "destructive" : undefined,
    });
  }, [keys, chosen, overrideType]);

  const selectedCount = (keys ?? []).filter((k) => chosen[k.object_key] && k.ok).length;

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-center gap-2">
        <KeyRound className="h-5 w-5 text-primary" />
        <h2 className="text-base font-semibold">Ingest by object key</h2>
        <Badge variant="outline" className="text-[11px]">no ListBucket needed</Badge>
        <Button
          variant="outline"
          size="sm"
          className="ml-auto"
          onClick={probeAccess}
          disabled={probing}
        >
          {probing ? (
            <Loader2 className="mr-1 h-4 w-4 animate-spin" />
          ) : (
            <ShieldQuestion className="mr-1 h-4 w-4" />
          )}
          Check bucket access
        </Button>
      </div>

      <p className="mt-2 text-xs text-muted-foreground">
        Paste the exact S3 keys Intuizi delivered — one per line. Bare keys,
        <span className="font-mono"> s3://bucket/key</span> URIs and console URLs all work. Each key is
        checked with HeadObject (the same read permission used to download), so this path works even
        when bucket listing is denied.
      </p>

      {probe && (
        <div className="mt-3 rounded-lg border border-border bg-muted/20 p-3">
          <p className="text-xs font-medium">
            Discovery mode: <span className="text-primary">{probe.mode}</span>
          </p>
          <div className="mt-2 space-y-1">
            {probe.prefixes.map((p) => (
              <div key={p.prefix || "(root)"} className="flex items-start gap-2 text-[11px]">
                {p.list_ok ? (
                  <CheckCircle2 className="mt-[2px] h-3 w-3 shrink-0 text-primary" />
                ) : (
                  <AlertTriangle className="mt-[2px] h-3 w-3 shrink-0 text-amber-500" />
                )}
                <span className="font-mono break-all">{p.prefix || "(bucket root)"}</span>
                <span className="text-muted-foreground break-all">
                  {p.list_ok ? `${p.objects_seen} object(s) visible` : p.error}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <Textarea
        value={raw}
        onChange={(e) => setRaw(e.target.value)}
        rows={4}
        spellCheck={false}
        placeholder={"845ad58c44eee47b75af72c9667bda04/activation_id5514_uniquedevices.parquet\ns3://intuizi-export-delivery/845ad58c.../ctv_signals.parquet"}
        className="mt-4 font-mono text-xs"
      />

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <Checkbox
            checked={expandManifest}
            onCheckedChange={(v) => setExpandManifest(v === true)}
          />
          Expand manifest files into their listed keys
        </label>

        <Select value={overrideType} onValueChange={setOverrideType}>
          <SelectTrigger className="h-9 w-[210px] text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="auto">Report type: auto-detect</SelectItem>
            {REPORT_TYPES.map((t) => (
              <SelectItem key={t} value={t}>
                Force report type: {t}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Button variant="secondary" size="sm" onClick={validate} disabled={validating || ingesting}>
          {validating ? (
            <Loader2 className="mr-1 h-4 w-4 animate-spin" />
          ) : (
            <ScanSearch className="mr-1 h-4 w-4" />
          )}
          Validate keys
        </Button>

        <Button size="sm" onClick={ingest} disabled={!selectedCount || ingesting || validating}>
          {ingesting ? (
            <Loader2 className="mr-1 h-4 w-4 animate-spin" />
          ) : (
            <Play className="mr-1 h-4 w-4" />
          )}
          Ingest {selectedCount || ""} selected
        </Button>
      </div>

      {!!manifestNotes.length && (
        <ul className="mt-3 space-y-1">
          {manifestNotes.map((n) => (
            <li key={n} className="text-[11px] text-muted-foreground break-all">• {n}</li>
          ))}
        </ul>
      )}

      {!!keys?.length && (
        <div className="mt-4 space-y-2">
          {keys.map((k) => (
            <div
              key={k.object_key}
              className={`rounded-lg border p-3 ${
                k.ok ? "border-primary/30 bg-primary/5" : "border-destructive/40 bg-destructive/5"
              }`}
            >
              <div className="flex items-start gap-2">
                <Checkbox
                  checked={!!chosen[k.object_key]}
                  disabled={!k.ok}
                  onCheckedChange={(v) =>
                    setChosen((prev) => ({ ...prev, [k.object_key]: v === true }))
                  }
                  className="mt-[2px]"
                />
                <div className="min-w-0 flex-1">
                  <p className="font-mono text-xs break-all">{fileName(k.object_key)}</p>
                  <p className="mt-1 flex flex-wrap gap-x-3 text-[11px] text-muted-foreground">
                    <span>{k.ok ? bytes(k.size) : "unreadable"}</span>
                    <span>
                      {k.is_audio ? "audio file" : k.report_type ?? "report type unknown"}
                    </span>
                    {k.already_ingested && <span className="text-amber-500">already ingested</span>}
                    {!k.already_ingested && k.prior_status && <span>prior run: {k.prior_status}</span>}
                  </p>
                  {k.error && (
                    <p className="mt-1 font-mono text-[11px] text-destructive break-all">{k.error}</p>
                  )}
                  {!k.error && k.needs_report_type && overrideType === "auto" && (
                    <p className="mt-1 text-[11px] text-amber-500">
                      Report type is not in the file name — force one above before ingesting.
                    </p>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {!!outcomes.length && (
        <div className="mt-4 space-y-2 border-t border-border pt-3">
          <p className="text-xs font-medium">Ingest results</p>
          {outcomes.map((o) => (
            <div key={o.object_key} className="rounded border border-border/60 bg-muted/20 p-2">
              <div className="flex items-start gap-2">
                {o.ok ? (
                  <CheckCircle2 className="mt-[2px] h-3 w-3 shrink-0 text-primary" />
                ) : (
                  <AlertTriangle className="mt-[2px] h-3 w-3 shrink-0 text-destructive" />
                )}
                <div className="min-w-0">
                  <p className="font-mono text-[11px] break-all">{fileName(o.object_key)}</p>
                  <p className="text-[11px] text-muted-foreground break-all">{o.detail}</p>
                  {o.rosterOnly && (
                    <p className="text-[11px] text-amber-500">
                      Roster only — device identifiers registered, but no taxonomy columns, so no
                      semantic scores. Ingest the matching signals report for this activation.
                    </p>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
};

export default IngestByKeyPanel;
