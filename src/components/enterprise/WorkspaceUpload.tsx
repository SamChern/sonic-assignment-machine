import { useCallback, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "@/hooks/use-toast";
import {
  CSV_COLUMNS,
  SAMPLE_CSV,
  normalizeCsv,
  type ParseReport,
} from "@/lib/enterpriseSchema";
import {
  AlertTriangle,
  CheckCircle2,
  CloudCog,
  Database,
  Download,
  FileSpreadsheet,
  Loader2,
  Play,
  Upload,
} from "lucide-react";

const CLOUD_PROVIDERS = [
  {
    id: "gcs",
    label: "Google Cloud Storage / BigQuery",
    fields: ["Project ID", "Dataset or bucket", "Service account email"],
  },
  { id: "s3", label: "AWS S3", fields: ["Bucket", "Region", "Prefix", "Role ARN"] },
  {
    id: "snowflake",
    label: "Snowflake",
    fields: ["Account", "Warehouse", "Database", "Schema", "Role"],
  },
] as const;

interface Props {
  organizationId: string;
  canWrite: boolean;
  onIngested?: () => void;
}

const WorkspaceUpload = ({ organizationId, canWrite, onIngested }: Props) => {
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState("");
  const [datasetName, setDatasetName] = useState("");
  const [description, setDescription] = useState("");
  const [report, setReport] = useState<ParseReport | null>(null);
  const [uploading, setUploading] = useState(false);
  const [scoring, setScoring] = useState(false);
  const [datasetId, setDatasetId] = useState<string | null>(null);

  const [provider, setProvider] = useState<string>("gcs");
  const [connName, setConnName] = useState("");
  const [connConfig, setConnConfig] = useState("");
  const [savingConn, setSavingConn] = useState(false);

  const onFile = useCallback(async (file: File) => {
    setFileName(file.name);
    if (!datasetName) setDatasetName(file.name.replace(/\.csv$/i, ""));
    const text = await file.text();
    setReport(normalizeCsv(text));
    setDatasetId(null);
  }, [datasetName]);

  const upload = useCallback(async () => {
    if (!report?.rows.length) return;
    setUploading(true);
    try {
      const { data, error } = await supabase.functions.invoke("enterprise-ingest-csv", {
        body: {
          organization_id: organizationId,
          dataset_name: datasetName || fileName || "Untitled dataset",
          description: description || null,
          rows: report.rows,
        },
      });
      if (error) throw new Error(error.message);
      if (!data?.success) throw new Error(data?.error ?? "Upload failed");
      setDatasetId(data.dataset_id);
      toast({
        title: "Dataset uploaded",
        description: `${data.rows_inserted} rows stored · ${data.rows_scored} already scored.`,
      });
      onIngested?.();
    } catch (e) {
      toast({ title: "Upload failed", description: (e as Error).message, variant: "destructive" });
    } finally {
      setUploading(false);
    }
  }, [report, organizationId, datasetName, fileName, description, onIngested]);

  const score = useCallback(async () => {
    if (!datasetId) return;
    setScoring(true);
    try {
      const { data, error } = await supabase.functions.invoke("enterprise-score-dataset", {
        body: { organization_id: organizationId, dataset_id: datasetId },
      });
      if (error) throw new Error(error.message);
      if (!data?.success) throw new Error(data?.error ?? "Scoring failed");
      toast({
        title: "Semantic scoring complete",
        description: `${data.scored} rows scored · ${data.unresolved} need audio evidence.`,
      });
      onIngested?.();
    } catch (e) {
      toast({ title: "Scoring failed", description: (e as Error).message, variant: "destructive" });
    } finally {
      setScoring(false);
    }
  }, [datasetId, organizationId, onIngested]);

  const saveConnection = useCallback(async () => {
    if (!connName.trim()) {
      toast({ title: "Name this connection first", variant: "destructive" });
      return;
    }
    setSavingConn(true);
    let config: Record<string, unknown> = {};
    if (connConfig.trim()) {
      try {
        config = JSON.parse(connConfig);
      } catch {
        config = { notes: connConfig.trim() };
      }
    }
    const { error } = await supabase.from("dataset_connections").insert({
      organization_id: organizationId,
      provider,
      name: connName.trim(),
      config,
      status: "configured",
    });
    setSavingConn(false);
    if (error) {
      toast({ title: "Could not save connection", description: error.message, variant: "destructive" });
      return;
    }
    setConnName("");
    setConnConfig("");
    toast({
      title: "Connection saved",
      description: "Credentials are requested separately before the first sync runs.",
    });
  }, [connName, connConfig, provider, organizationId]);

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="flex flex-wrap items-center gap-2">
          <FileSpreadsheet className="h-4 w-4 text-primary" />
          <h2 className="text-sm font-semibold">Upload my own data</h2>
          <Badge variant="outline" className="text-[11px]">CSV</Badge>
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto"
            onClick={() => {
              const blob = new Blob([SAMPLE_CSV], { type: "text/csv" });
              const a = document.createElement("a");
              a.href = URL.createObjectURL(blob);
              a.download = "sonicsim-template.csv";
              a.click();
              URL.revokeObjectURL(a.href);
            }}
          >
            <Download className="mr-1 h-4 w-4" />
            Template
          </Button>
        </div>

        <div className="mt-3 overflow-hidden rounded-lg border border-border/60">
          <table className="w-full text-left text-[11px]">
            <thead className="bg-muted/40">
              <tr>
                <th className="p-2 font-medium">Column</th>
                <th className="p-2 font-medium">Required</th>
                <th className="p-2 font-medium">What it does</th>
              </tr>
            </thead>
            <tbody>
              {CSV_COLUMNS.map((c) => (
                <tr key={c.name} className="border-t border-border/40">
                  <td className="p-2 font-mono">{c.name}</td>
                  <td className="p-2">{c.required ? "yes" : "optional"}</td>
                  <td className="p-2 text-muted-foreground">{c.description}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          <Input
            value={datasetName}
            onChange={(e) => setDatasetName(e.target.value)}
            placeholder="Dataset name"
          />
          <Input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Description (optional)"
          />
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void onFile(f);
            }}
          />
          <Button variant="secondary" size="sm" onClick={() => fileRef.current?.click()}>
            <Upload className="mr-1 h-4 w-4" />
            Choose CSV
          </Button>
          {fileName && <span className="text-xs text-muted-foreground">{fileName}</span>}
        </div>

        {report && (
          <div className="mt-4 rounded-lg border border-border/60 bg-muted/20 p-3">
            <p className="text-xs font-medium">
              {report.rows.length} rows parsed · {report.scoredRows} fully pre-scored
            </p>
            {!!report.missingRequired.length && (
              <p className="mt-1 flex items-start gap-1 text-[11px] text-destructive">
                <AlertTriangle className="mt-[2px] h-3 w-3 shrink-0" />
                Missing required column: {report.missingRequired.join(", ")}
              </p>
            )}
            {!!report.rowsWithoutSource && (
              <p className="mt-1 text-[11px] text-amber-500">
                {report.rowsWithoutSource} row(s) have no source_name and cannot be semantically scored.
              </p>
            )}
            {!!report.unknownColumns.length && (
              <p className="mt-1 text-[11px] text-muted-foreground">
                Ignored columns: {report.unknownColumns.join(", ")} — prefix with attr_ to keep them.
              </p>
            )}
            {!!report.kpiColumns.length && (
              <p className="mt-1 flex items-start gap-1 text-[11px] text-primary">
                <CheckCircle2 className="mt-[2px] h-3 w-3 shrink-0" />
                KPI columns detected: {report.kpiColumns.join(", ")}
              </p>
            )}

            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                size="sm"
                onClick={upload}
                disabled={
                  !canWrite || uploading || !report.rows.length || !!report.missingRequired.length
                }
              >
                {uploading ? (
                  <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                ) : (
                  <Database className="mr-1 h-4 w-4" />
                )}
                Upload dataset
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={score}
                disabled={!datasetId || scoring || !canWrite}
              >
                {scoring ? (
                  <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                ) : (
                  <Play className="mr-1 h-4 w-4" />
                )}
                Run semantic scoring
              </Button>
            </div>
            {!canWrite && (
              <p className="mt-2 text-[11px] text-muted-foreground">
                Your role is view-only in this workspace.
              </p>
            )}
          </div>
        )}
      </Card>

      <Card className="p-4">
        <div className="flex flex-wrap items-center gap-2">
          <CloudCog className="h-4 w-4 text-primary" />
          <h2 className="text-sm font-semibold">Connect a cloud warehouse or bucket</h2>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          Register where your data lives. Credentials are requested separately in a secure form
          before the first sync, so nothing sensitive is stored in this form.
        </p>

        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <Select value={provider} onValueChange={setProvider}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CLOUD_PROVIDERS.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            value={connName}
            onChange={(e) => setConnName(e.target.value)}
            placeholder="Connection name"
          />
        </div>

        <p className="mt-2 text-[11px] text-muted-foreground">
          Expected details:{" "}
          {CLOUD_PROVIDERS.find((p) => p.id === provider)?.fields.join(", ")}
        </p>

        <Textarea
          value={connConfig}
          onChange={(e) => setConnConfig(e.target.value)}
          rows={3}
          placeholder='{"bucket":"my-bucket","region":"us-east-1","prefix":"exports/"}'
          className="mt-2 font-mono text-xs"
        />

        <Button
          size="sm"
          className="mt-3"
          onClick={saveConnection}
          disabled={savingConn || !canWrite}
        >
          {savingConn && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
          Save connection
        </Button>
      </Card>
    </div>
  );
};

export default WorkspaceUpload;
