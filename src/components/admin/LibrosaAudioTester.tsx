import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Loader2, Upload, Music, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { LibrosaVisuals } from "@/components/visuals/LibrosaVisuals";
import type { LibrosaFeatures } from "@/hooks/useLibrosaFeatures";

const BUCKET = "admin-audio-tests";
const MAX_BYTES = 20 * 1024 * 1024; // 20 MB
const ALLOWED = ["audio/mpeg", "audio/mp3", "audio/wav", "audio/x-wav", "audio/flac", "audio/ogg", "audio/mp4", "audio/aac"];

interface ToolContent {
  type: string;
  text?: string;
}
interface ToolResult {
  content?: ToolContent[];
  isError?: boolean;
  [k: string]: unknown;
}

export function LibrosaAudioTester() {
  const [file, setFile] = useState<File | null>(null);
  const [tool, setTool] = useState("get_duration");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<ToolResult | null>(null);
  const [fullFeatures, setFullFeatures] = useState<LibrosaFeatures | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [latencyMs, setLatencyMs] = useState<number | null>(null);

  const onFile = (f: File | null) => {
    setError(null);
    setResult(null);
    setFullFeatures(null);
    if (!f) return setFile(null);
    if (f.size > MAX_BYTES) {
      setError(`File too large (${(f.size / 1024 / 1024).toFixed(1)} MB). Max 20 MB.`);
      return;
    }
    if (f.type && !ALLOWED.includes(f.type)) {
      // Don't block — some browsers report empty type for .flac etc.
      console.warn("Unexpected MIME type", f.type);
    }
    setFile(f);
  };

  const run = async () => {
    if (!file) return;
    setRunning(true);
    setError(null);
    setResult(null);
    setLatencyMs(null);
    const t0 = performance.now();

    // 1) Upload to private storage
    const { data: userData } = await supabase.auth.getUser();
    const userId = userData.user?.id ?? "anon";
    const path = `${userId}/${Date.now()}-${file.name.replace(/[^\w.\-]/g, "_")}`;
    const { error: upErr } = await supabase.storage
      .from(BUCKET)
      .upload(path, file, { contentType: file.type || "application/octet-stream", upsert: false });
    if (upErr) {
      setRunning(false);
      setError(`Upload failed: ${upErr.message}`);
      return;
    }

    // 2) Signed URL the MCP server can fetch from (60 minutes)
    const { data: signed, error: signErr } = await supabase.storage
      .from(BUCKET)
      .createSignedUrl(path, 3600);
    if (signErr || !signed?.signedUrl) {
      setRunning(false);
      setError(`Could not sign URL: ${signErr?.message ?? "unknown"}`);
      return;
    }

    // 3) Call the MCP tool (download_from_url first → returns local path → run analysis tool)
    try {
      // 3a) Download remote signed URL onto the MCP host
      const downloadCall = await supabase.functions.invoke("librosa-mcp-call", {
        body: { tool_name: "download_from_url", arguments: { url: signed.signedUrl } },
      });
      if (downloadCall.error || !downloadCall.data?.success) {
        throw new Error(downloadCall.data?.error ?? downloadCall.error?.message ?? "download failed");
      }
      const localPath = (downloadCall.data.result as ToolResult).content?.[0]?.text?.trim();
      if (!localPath) throw new Error("MCP did not return a local file path");

      // 3b) load → persist waveform CSV, returns { y_path, sr }
      const loadCall = await supabase.functions.invoke("librosa-mcp-call", {
        body: { tool_name: "load", arguments: { file_path: localPath } },
      });
      if (loadCall.error || !loadCall.data?.success) {
        throw new Error(loadCall.data?.error ?? loadCall.error?.message ?? "load failed");
      }
      const loadText = (loadCall.data.result as ToolResult).content?.[0]?.text ?? "{}";
      let yPath = "";
      try { yPath = JSON.parse(loadText).y_path as string; } catch { /* noop */ }
      if (!yPath) throw new Error(`load did not return y_path: ${loadText.slice(0, 200)}`);

      // 3c) Run the actual analysis tool against the waveform CSV
      const analyseCall = await supabase.functions.invoke("librosa-mcp-call", {
        body: { tool_name: tool, arguments: { path_audio_time_series_y: yPath } },
      });
      if (analyseCall.error || !analyseCall.data?.success) {
        throw new Error(analyseCall.data?.error ?? analyseCall.error?.message ?? "tool failed");
      }
      setResult(analyseCall.data.result as ToolResult);
      setLatencyMs(Math.round(performance.now() - t0));
      toast.success(`MCP returned in ${Math.round(performance.now() - t0)} ms`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Unknown error";
      setError(msg);
      toast.error(msg);
    } finally {
      setRunning(false);
      // Best-effort cleanup of the uploaded sample
      supabase.storage.from(BUCKET).remove([path]).catch(() => {});
    }
  };

  const renderResult = () => {
    if (!result) return null;
    const text = result.content?.map((c) => c.text ?? "").join("\n").trim();
    return (
      <div className="space-y-2">
        {text && (
          <pre className="text-xs bg-muted/40 border border-border rounded-md p-3 whitespace-pre-wrap break-words max-h-80 overflow-auto">
            {text}
          </pre>
        )}
        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer">Raw JSON</summary>
          <pre className="mt-2 bg-muted/40 border border-border rounded-md p-3 overflow-auto max-h-60">
            {JSON.stringify(result, null, 2)}
          </pre>
        </details>
      </div>
    );
  };

  return (
    <Card className="p-6 space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-2">
          <Music className="h-5 w-5 text-primary" />
          <div>
            <h2 className="text-lg font-semibold">Librosa MCP — Audio sample test</h2>
            <p className="text-sm text-muted-foreground">
              Upload a short audio file. It's stored privately, sent to the
              Librosa MCP server via a signed URL, and the analysis is shown
              below.
            </p>
          </div>
        </div>
        <Badge variant="outline">mcp_librosa</Badge>
      </div>

      <div className="grid gap-3 sm:grid-cols-[1fr_220px] items-end">
        <div className="space-y-1.5">
          <Label htmlFor="audio-file">Audio file (max 20 MB)</Label>
          <Input
            id="audio-file"
            type="file"
            accept="audio/*"
            onChange={(e) => onFile(e.target.files?.[0] ?? null)}
            disabled={running}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="tool">MCP tool</Label>
          <select
            id="tool"
            value={tool}
            onChange={(e) => setTool(e.target.value)}
            disabled={running}
            className="flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm"
          >
            <option value="get_duration">get_duration</option>
            <option value="tempo">tempo (beat tracking)</option>
            <option value="beat_track">beat_track</option>
            <option value="mfcc">mfcc</option>
            <option value="chroma_cqt">chroma_cqt</option>
          </select>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Button onClick={run} disabled={!file || running}>
          {running ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <Upload className="h-4 w-4 mr-2" />
          )}
          Send to Librosa
        </Button>
        {latencyMs !== null && !running && (
          <span className="text-xs text-muted-foreground">{latencyMs} ms</span>
        )}
      </div>

      {error && (
        <div className="flex items-start gap-2 text-sm text-destructive border border-destructive/40 bg-destructive/5 rounded-md p-3">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
          <span className="break-words">{error}</span>
        </div>
      )}

      {renderResult()}
    </Card>
  );
}
