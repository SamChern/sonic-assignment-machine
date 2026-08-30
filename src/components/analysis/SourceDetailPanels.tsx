/**
 * Per-source detail panels rendered underneath each analyzed source in
 * AnalysisResults: the collapsible acoustic visuals, the always-on harmonic
 * preview, and the nearest-neighbor context list.
 *
 * Split out of AnalysisResults so that file stays under the component ceiling;
 * behaviour is unchanged apart from a visible error surface on the neighbor
 * query, which previously failed silently.
 */
import { Suspense, lazy, useEffect, useState } from "react";
import { Waves } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useStoredLibrosaFeatures } from "@/hooks/useLibrosaFeatures";
import { supabase } from "@/integrations/supabase/client";

const LibrosaVisuals = lazy(() =>
  import("@/components/visuals/LibrosaVisuals").then((m) => ({ default: m.LibrosaVisuals })),
);
const ChromaTonnetzPanel = lazy(() =>
  import("@/components/visuals/LibrosaVisuals").then((m) => ({ default: m.ChromaTonnetzPanel })),
);

const VisualsFallback = () => <div className="h-24 animate-pulse rounded-md bg-secondary/30" />;

/**
 * Collapsible "Acoustic visuals" panel. Only fetches the cached librosa_features
 * blob when the user opens it.
 */
export function AcousticVisualsToggle({ audioSourceId }: { audioSourceId: string }) {
  const [open, setOpen] = useState(false);
  const { features, loading, status } = useStoredLibrosaFeatures(open ? audioSourceId : null);

  const statusLabel =
    status === "queued"
      ? "Queued for analysis…"
      : status === "processing"
        ? "Analyzing audio…"
        : status === "failed"
          ? "Analysis failed for this source."
          : null;

  return (
    <div className="mt-6 border-t border-border/50 pt-4">
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="text-muted-foreground hover:text-foreground"
      >
        <Waves className="mr-2 h-4 w-4" />
        {open ? "Hide acoustic visuals" : "Show acoustic visuals"}
      </Button>
      {open && (
        <div className="mt-3">
          {loading && <p className="text-xs text-muted-foreground">Loading…</p>}
          {!loading && !features && statusLabel && (
            <p
              className={`text-xs ${
                status === "failed" ? "text-destructive" : "text-muted-foreground"
              }`}
            >
              {statusLabel}
            </p>
          )}
          {!loading && !features && !statusLabel && (
            <p className="text-xs text-muted-foreground">
              No acoustic features cached for this source yet.
            </p>
          )}
          {features && (
            <Suspense fallback={<VisualsFallback />}>
              <LibrosaVisuals features={features} />
            </Suspense>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Always-visible chroma heatmap + tonnetz preview. Silently no-ops if the source
 * has no cached librosa_features yet.
 */
export function HarmonicPreview({ audioSourceId }: { audioSourceId: string }) {
  const { features } = useStoredLibrosaFeatures(audioSourceId);
  if (!features) return null;
  return (
    <div className="mt-6 border-t border-border/50 pt-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Waves className="h-4 w-4 text-primary" />
        <h4 className="text-sm font-semibold">Harmonic preview</h4>
        <span className="text-xs text-muted-foreground">chroma · tonnetz</span>
      </div>
      <Suspense fallback={<VisualsFallback />}>
        <ChromaTonnetzPanel features={features} />
      </Suspense>
    </div>
  );
}

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

/**
 * Nearest-neighbor context for a source: re-queried whenever refreshKey changes
 * (e.g. after admin feedback is submitted and calibration re-runs).
 */
export function NeighborContext({
  audioSourceId,
  refreshKey,
}: {
  audioSourceId: string;
  refreshKey: number;
}) {
  const [rows, setRows] = useState<NeighborRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const { data: src, error: srcErr } = await supabase
          .from("audio_sources")
          .select("profile_embedding")
          .eq("id", audioSourceId)
          .maybeSingle();
        if (srcErr) throw srcErr;

        const embedding = (src as { profile_embedding?: unknown } | null)?.profile_embedding;
        if (!embedding) {
          if (!cancelled) setRows(null);
          return;
        }

        const { data, error: rpcErr } = await supabase.rpc("match_audio_profiles", {
          query_embedding: embedding as never,
          match_count: 5,
          exclude_id: audioSourceId,
        });
        if (rpcErr) throw rpcErr;
        if (!cancelled) setRows((data as NeighborRow[]) ?? []);
      } catch (err) {
        if (!cancelled) {
          setRows(null);
          setError(err instanceof Error ? err.message : "Could not load neighbors.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [audioSourceId, refreshKey]);

  if (!loading && !error && (!rows || rows.length === 0)) return null;

  return (
    <div className="mt-6 border-t border-border/50 pt-4">
      <h4 className="mb-2 text-sm font-semibold">Neighbor context</h4>
      {loading ? (
        <p className="text-xs text-muted-foreground">Refreshing neighbors…</p>
      ) : error ? (
        <p className="text-xs text-destructive">{error}</p>
      ) : (
        <div className="space-y-1">
          {rows?.map((n) => (
            <div key={n.id} className="flex items-center gap-3 text-xs">
              <span className="flex-1 truncate">{n.name}</span>
              <span className="tabular-nums text-muted-foreground">
                {(Number(n.similarity) * 100).toFixed(0)}%
              </span>
              <span className="hidden tabular-nums text-muted-foreground sm:inline">
                {[
                  n.emotional_score,
                  n.cognitive_score,
                  n.social_score,
                  n.communication_score,
                  n.contextual_score,
                  n.artistic_score,
                ]
                  .map((s) => Math.round(Number(s)))
                  .join(" · ")}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
