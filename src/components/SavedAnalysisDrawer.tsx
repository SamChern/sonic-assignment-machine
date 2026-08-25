import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { AudioLines, Loader2 } from "lucide-react";

export interface DrawerAnalysis {
  id: string;
  source_name: string;
  audio_source_id: string | null;
  category: string | null;
  confidence: number | null;
  created_at: string;
  emotional_score: number;
  cognitive_score: number;
  social_score: number;
  communication_score: number;
  contextual_score: number;
  artistic_score: number;
}

const CATEGORIES = [
  ["emotional", "Emotional", "var(--gradient-emotional)"],
  ["cognitive", "Cognitive", "var(--gradient-cognitive)"],
  ["social", "Social", "var(--gradient-social)"],
  ["communication", "Communication", "var(--gradient-communication)"],
  ["contextual", "Contextual", "var(--gradient-contextual)"],
  ["artistic", "Artistic", "var(--gradient-artistic)"],
] as const;

interface DetailRow {
  emotional_desc: string | null;
  cognitive_desc: string | null;
  social_desc: string | null;
  communication_desc: string | null;
  contextual_desc: string | null;
  artistic_desc: string | null;
  raw_scores: Record<string, unknown> | null;
  normalization: Record<string, unknown> | null;
}

interface SourceRow {
  name: string;
  source_type: string;
  album_name: string | null;
  album_image: string | null;
  artists: string[] | null;
  analysis_status: string | null;
  librosa_features: Record<string, unknown> | null;
  created_at: string;
}

/** Deterministic bar heights so the preview is stable per analysis. */
function fallbackWave(seed: string, count = 72) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Array.from({ length: count }, (_, i) => {
    h = Math.imul(h ^ (i + 1), 16777619);
    return 0.15 + (Math.abs(h % 1000) / 1000) * 0.85;
  });
}

/** Pull a 1-D envelope out of cached librosa features when present. */
function librosaWave(features: Record<string, unknown> | null | undefined) {
  if (!features) return null;
  for (const key of ["rms", "rms_envelope", "envelope", "onset_envelope", "waveform"]) {
    const v = (features as Record<string, unknown>)[key];
    if (Array.isArray(v) && v.length > 4 && v.every((n) => typeof n === "number")) {
      const nums = v as number[];
      const max = Math.max(...nums.map(Math.abs)) || 1;
      const step = Math.max(1, Math.floor(nums.length / 96));
      const out: number[] = [];
      for (let i = 0; i < nums.length; i += step) out.push(Math.abs(nums[i]) / max);
      return out;
    }
  }
  return null;
}

const Waveform = ({ bars }: { bars: number[] }) => (
  <div className="flex h-28 items-center gap-[2px] overflow-hidden rounded-lg border border-border/60 bg-muted/20 px-2">
    {bars.map((b, i) => (
      <div
        key={i}
        className="flex-1 rounded-full bg-primary/70"
        style={{ height: `${Math.max(6, b * 100)}%` }}
      />
    ))}
  </div>
);

const SavedAnalysisDrawer = ({
  analysis,
  open,
  onOpenChange,
}: {
  analysis: DrawerAnalysis | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) => {
  const [detail, setDetail] = useState<DetailRow | null>(null);
  const [source, setSource] = useState<SourceRow | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !analysis) return;
    let cancelled = false;
    setLoading(true);
    setDetail(null);
    setSource(null);
    (async () => {
      const { data: det } = await supabase
        .from("source_analyses")
        .select(
          "emotional_desc, cognitive_desc, social_desc, communication_desc, contextual_desc, artistic_desc, raw_scores, normalization",
        )
        .eq("id", analysis.id)
        .maybeSingle();
      let src: SourceRow | null = null;
      if (analysis.audio_source_id) {
        const { data } = await supabase
          .from("audio_sources")
          .select(
            "name, source_type, album_name, album_image, artists, analysis_status, librosa_features, created_at",
          )
          .eq("id", analysis.audio_source_id)
          .maybeSingle();
        src = (data as unknown as SourceRow) ?? null;
      }
      if (cancelled) return;
      setDetail((det as unknown as DetailRow) ?? null);
      setSource(src);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, analysis]);

  const bars = useMemo(() => {
    if (!analysis) return [];
    return librosaWave(source?.librosa_features) ?? fallbackWave(analysis.id);
  }, [analysis, source]);

  if (!analysis) return null;

  const meta: Array<[string, string]> = [
    ["Analysis ID", analysis.id],
    ["Source type", source?.source_type ?? "—"],
    ["Audio source", analysis.audio_source_id ?? "not linked"],
    ["Album", source?.album_name ?? "—"],
    ["Artists", source?.artists?.join(", ") || "—"],
    ["Pipeline status", source?.analysis_status ?? "—"],
    ["Analyzed", new Date(analysis.created_at).toLocaleString()],
    [
      "Normalization",
      detail?.normalization && Object.keys(detail.normalization).length ? "applied" : "none",
    ],
  ];

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle className="pr-6 text-base">{analysis.source_name}</SheetTitle>
          <SheetDescription className="flex flex-wrap items-center gap-2">
            {analysis.category && (
              <Badge variant="secondary" className="text-[11px]">
                {analysis.category}
              </Badge>
            )}
            <span className="text-xs">
              confidence {Math.round(Number(analysis.confidence ?? 0) * 100)}%
            </span>
          </SheetDescription>
        </SheetHeader>

        <div className="mt-4 space-y-5 pb-[var(--safe-bottom,0px)]">
          {source?.album_image ? (
            <img
              src={source.album_image}
              alt={`Cover art for ${analysis.source_name}`}
              loading="lazy"
              className="h-48 w-full rounded-lg border border-border/60 object-cover"
            />
          ) : null}

          <div>
            <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-muted-foreground">
              <AudioLines className="h-3.5 w-3.5 text-primary" />
              {librosaWave(source?.librosa_features)
                ? "Waveform (librosa envelope)"
                : "Waveform preview"}
            </div>
            {loading ? <Skeleton className="h-28 w-full" /> : <Waveform bars={bars} />}
          </div>

          <div>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Category scores
            </h3>
            <div className="space-y-3">
              {CATEGORIES.map(([key, label, gradient]) => {
                const score = Math.round(
                  Number(analysis[`${key}_score` as keyof DrawerAnalysis] ?? 0),
                );
                const desc = detail?.[`${key}_desc` as keyof DetailRow] as string | null;
                return (
                  <div key={key}>
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-medium">{label}</span>
                      <span className="tabular-nums text-muted-foreground">{score}</span>
                    </div>
                    <div className="mt-1 h-2 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full transition-smooth"
                        style={{
                          width: `${Math.max(2, Math.min(100, score))}%`,
                          background: gradient,
                        }}
                      />
                    </div>
                    {loading ? (
                      <Skeleton className="mt-1.5 h-3 w-3/4" />
                    ) : desc ? (
                      <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
                        {desc}
                      </p>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>

          <div>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Metadata
            </h3>
            <dl className="grid grid-cols-1 gap-x-4 gap-y-2 sm:grid-cols-2">
              {meta.map(([k, v]) => (
                <div key={k} className="min-w-0">
                  <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">{k}</dt>
                  <dd className="break-all text-xs">{v}</dd>
                </div>
              ))}
            </dl>
          </div>

          {loading && (
            <p className="flex items-center gap-2 text-[11px] text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" /> Loading full analysis details…
            </p>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
};

export default SavedAnalysisDrawer;
