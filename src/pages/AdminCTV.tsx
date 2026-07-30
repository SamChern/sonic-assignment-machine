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
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!loading && (!user || !isAdmin)) navigate("/");
  }, [loading, user, isAdmin, navigate]);

  const loadBatches = async () => {
    const { data } = await supabase
      .from("ctv_ingest_batches")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(25);
    setBatches((data ?? []) as unknown as Batch[]);
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

      <div className="mb-6">
        <LibrosaHealthPanel />
      </div>



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
        {batches.map(b => {
          const isOpen = !!expanded[b.id];
          const details = b.row_details ?? [];
          return (
            <Card key={b.id} className="p-3 text-sm">
              <div className="flex items-center justify-between">
                <button
                  className="flex items-center gap-2 text-left flex-1 min-w-0"
                  onClick={() => setExpanded(s => ({ ...s, [b.id]: !s[b.id] }))}
                >
                  {isOpen ? <ChevronDown className="w-4 h-4 shrink-0" /> : <ChevronRight className="w-4 h-4 shrink-0" />}
                  <div className="min-w-0">
                    <div className="font-medium truncate">{b.feed_name}</div>
                    <div className="text-muted-foreground text-xs">
                      {new Date(b.created_at).toLocaleString()}
                    </div>
                  </div>
                </button>
                <div className="flex items-center gap-3 shrink-0">
                  <span className="text-xs text-muted-foreground">
                    {b.success_rows}/{b.total_rows} ok · {b.failed_rows} failed
                  </span>
                  <Badge variant={
                    b.status === "completed" ? "default" :
                    b.status === "failed" ? "destructive" :
                    b.status === "partial" ? "secondary" : "outline"
                  }>{b.status}</Badge>
                </div>
              </div>

              {b.error_message && (
                <div className="text-destructive text-xs mt-2 whitespace-pre-wrap">
                  {b.error_message}
                </div>
              )}

              {isOpen && (
                <div className="mt-3 space-y-3 border-t pt-3">
                  {details.length === 0 && (
                    <p className="text-xs text-muted-foreground">
                      No row details captured for this batch.
                    </p>
                  )}
                  {details.map((d, i) => (
                    <div key={i} className="rounded-md border bg-muted/30 p-3 space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <div className="font-medium text-sm truncate">{d.name}</div>
                        <Badge variant={d.status === "ok" ? "secondary" : "destructive"} className="text-[10px]">
                          {d.status}
                        </Badge>
                      </div>

                      {d.error && (
                        <div className="text-destructive text-xs whitespace-pre-wrap">{d.error}</div>
                      )}

                      {d.tag_codes && d.tag_codes.length > 0 && (
                        <div className="flex flex-wrap gap-1">
                          {d.tag_codes.map(c => (
                            <Badge key={c} variant="outline" className="text-[10px] font-mono">{c}</Badge>
                          ))}
                        </div>
                      )}

                      {d.taxonomy_context && (
                        <div>
                          <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">
                            taxonomy_context
                          </div>
                          <pre className="text-[11px] font-mono whitespace-pre-wrap bg-background rounded p-2 border max-h-48 overflow-auto">
{d.taxonomy_context}
                          </pre>
                        </div>
                      )}

                      {d.neighbors && d.neighbors.length > 0 && (
                        <div>
                          <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">
                            Top-{d.neighbors.length} nearest neighbors
                          </div>
                          <div className="overflow-x-auto">
                            <table className="w-full text-[11px] font-mono">
                              <thead className="text-muted-foreground">
                                <tr>
                                  <th className="text-left pr-2 py-1">name</th>
                                  <th className="text-right px-1">sim</th>
                                  <th className="text-right px-1">emo</th>
                                  <th className="text-right px-1">cog</th>
                                  <th className="text-right px-1">soc</th>
                                  <th className="text-right px-1">com</th>
                                  <th className="text-right px-1">ctx</th>
                                  <th className="text-right pl-1">art</th>
                                </tr>
                              </thead>
                              <tbody>
                                {d.neighbors.map(n => (
                                  <tr key={n.id} className="border-t border-border/50">
                                    <td className="pr-2 py-1 truncate max-w-[200px]">{n.name}</td>
                                    <td className="text-right px-1">{Number(n.similarity).toFixed(2)}</td>
                                    <td className="text-right px-1">{Math.round(n.emotional_score)}</td>
                                    <td className="text-right px-1">{Math.round(n.cognitive_score)}</td>
                                    <td className="text-right px-1">{Math.round(n.social_score)}</td>
                                    <td className="text-right px-1">{Math.round(n.communication_score)}</td>
                                    <td className="text-right px-1">{Math.round(n.contextual_score)}</td>
                                    <td className="text-right pl-1">{Math.round(n.artistic_score)}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}

                      {d.scores && (
                        <div className="text-[11px] font-mono text-muted-foreground">
                          final: {Object.entries(d.scores).map(([k, v]) => `${k.slice(0,3)}=${Math.round(Number(v))}`).join(" · ")}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </Card>
          );
        })}
        {batches.length === 0 && (
          <p className="text-sm text-muted-foreground">No batches yet.</p>
        )}
      </div>
    </div>
  );
}
