import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { ArrowLeft, Upload, RefreshCw, Brain, ChevronDown, ChevronRight } from "lucide-react";

interface NeighborRow {
  id: string;
  name: string;
  similarity: number;
  emotional_score: number;
  cognitive_score: number;
  social_score: number;
  communication_score: number;
  contextual_score: number;
  artistic_score: number;
}

interface RowDetail {
  name: string;
  status: "ok" | "failed";
  audio_source_id?: string;
  tag_codes?: string[];
  taxonomy_context?: string;
  neighbors?: NeighborRow[];
  scores?: Record<string, number>;
  error?: string;
}

interface Batch {
  id: string;
  feed_name: string;
  status: string;
  total_rows: number;
  success_rows: number;
  failed_rows: number;
  created_at: string;
  error_message: string | null;
  row_details: RowDetail[] | null;
}

const SAMPLE = JSON.stringify({
  feed_name: "demo_ctv_feed",
  rows: [
    {
      name: "Acme Insurance — 30s Spot",
      audio_url: "https://example.com/spot1.mp3",
      tags: [
        { code: "ctv.ad.insurance", label: "Insurance Ad", parent_code: "ctv.ad" },
        { code: "ctv.tone.reassuring", label: "Reassuring Tone" },
      ],
      metadata: { duration_s: 30, advertiser: "Acme" },
    },
  ],
}, null, 2);

export default function AdminCTV() {
  const { user, isAdmin, loading } = useAuth();
  const navigate = useNavigate();
  const [payload, setPayload] = useState(SAMPLE);
  const [feedName, setFeedName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [recalibrating, setRecalibrating] = useState(false);
  const [batches, setBatches] = useState<Batch[]>([]);

  useEffect(() => {
    if (!loading && (!user || !isAdmin)) navigate("/");
  }, [loading, user, isAdmin, navigate]);

  const loadBatches = async () => {
    const { data } = await supabase
      .from("ctv_ingest_batches")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(25);
    setBatches((data ?? []) as Batch[]);
  };

  useEffect(() => { loadBatches(); }, []);

  const submit = async () => {
    setSubmitting(true);
    try {
      const parsed = JSON.parse(payload);
      if (feedName) parsed.feed_name = feedName;
      const { data, error } = await supabase.functions.invoke("ctv-ingest", { body: parsed });
      if (error) throw error;
      toast.success(`Ingested ${data.success}/${data.success + data.failed} rows`);
      if (data.errors?.length) console.warn("CTV ingest errors:", data.errors);
      loadBatches();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Ingest failed");
    } finally {
      setSubmitting(false);
    }
  };

  const recalibrate = async () => {
    setRecalibrating(true);
    try {
      const { data, error } = await supabase.functions.invoke("recalibrate-categories", { body: {} });
      if (error) throw error;
      toast.success(`Processed ${data.processed} feedback rows`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Recalibration failed");
    } finally {
      setRecalibrating(false);
    }
  };

  if (loading) return null;

  return (
    <div className="container mx-auto py-8 px-4 max-w-5xl">
      <Button variant="ghost" onClick={() => navigate("/admin")} className="mb-4">
        <ArrowLeft className="w-4 h-4 mr-2" /> Back to admin
      </Button>

      <h1 className="text-2xl font-bold mb-2">CTV Ingestion</h1>
      <p className="text-muted-foreground mb-6">
        Ingest CTV audio batches. Each row is tagged with taxonomy nodes, scored against
        the ontology with prior calibration from past runs, embedded, and stored alongside
        Spotify/Apple-derived sources.
      </p>

      <Card className="p-4 mb-6 space-y-3">
        <Input
          placeholder="Feed name (overrides payload.feed_name)"
          value={feedName}
          onChange={(e) => setFeedName(e.target.value)}
        />
        <Textarea
          className="font-mono text-xs min-h-[280px]"
          value={payload}
          onChange={(e) => setPayload(e.target.value)}
        />
        <div className="flex gap-2">
          <Button onClick={submit} disabled={submitting}>
            <Upload className="w-4 h-4 mr-2" />
            {submitting ? "Ingesting…" : "Ingest batch"}
          </Button>
          <Button variant="outline" onClick={recalibrate} disabled={recalibrating}>
            <Brain className="w-4 h-4 mr-2" />
            {recalibrating ? "Recalibrating…" : "Apply feedback → calibration"}
          </Button>
          <Button variant="ghost" onClick={loadBatches}>
            <RefreshCw className="w-4 h-4 mr-2" /> Refresh
          </Button>
        </div>
      </Card>

      <h2 className="text-lg font-semibold mb-3">Recent batches</h2>
      <div className="space-y-2">
        {batches.map(b => (
          <Card key={b.id} className="p-3 flex items-center justify-between text-sm">
            <div>
              <div className="font-medium">{b.feed_name}</div>
              <div className="text-muted-foreground text-xs">
                {new Date(b.created_at).toLocaleString()}
              </div>
              {b.error_message && (
                <div className="text-destructive text-xs mt-1 whitespace-pre-wrap">
                  {b.error_message}
                </div>
              )}
            </div>
            <div className="flex items-center gap-3">
              <span className="text-xs text-muted-foreground">
                {b.success_rows}/{b.total_rows} ok · {b.failed_rows} failed
              </span>
              <Badge variant={
                b.status === "completed" ? "default" :
                b.status === "failed" ? "destructive" :
                b.status === "partial" ? "secondary" : "outline"
              }>{b.status}</Badge>
            </div>
          </Card>
        ))}
        {batches.length === 0 && (
          <p className="text-sm text-muted-foreground">No batches yet.</p>
        )}
      </div>
    </div>
  );
}
