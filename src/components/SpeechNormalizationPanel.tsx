import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "@/hooks/use-toast";
import { Loader2, Mic } from "lucide-react";
import NormalizationControls from "@/components/speech/NormalizationControls";
import LivePreview from "@/components/speech/LivePreview";
import ImpactBreakdown from "@/components/speech/ImpactBreakdown";
import {
  CATEGORIES,
  DEFAULT_GAINS,
  SCOPES,
  SOURCE_TYPES_BY_SCOPE,
  computeAutoTune,
  explainNormalization,
  normalizeScores,
  type AutoTuneResult,
  type Category,
  type Cfg,
} from "@/lib/speechNormalization";

export {
  normalizeScores,
  explainNormalization,
  computeAutoTune,
  type ImpactRow,
  type AutoTuneResult,
} from "@/lib/speechNormalization";

interface Props {
  /** Optional live sample (e.g. the selected activation's current scores). */
  sample?: Partial<Record<Category, number>> | null;
  sampleLabel?: string;
}

const SpeechNormalizationPanel = ({ sample, sampleLabel }: Props) => {
  const [scope, setScope] = useState("intuizi");
  const [cfg, setCfg] = useState<Cfg | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [tuning, setTuning] = useState(false);
  const [tune, setTune] = useState<AutoTuneResult | null>(null);

  const runAutoTune = useCallback(async () => {
    setTuning(true);
    setTune(null);
    const types = SOURCE_TYPES_BY_SCOPE[scope];
    const { data, error } = await supabase
      .from("source_analyses")
      .select(
        "raw_scores,emotional_score,cognitive_score,social_score,communication_score,contextual_score,artistic_score,created_at,audio_sources!inner(source_type)",
      )
      .order("created_at", { ascending: false })
      .limit(300);
    setTuning(false);
    if (error) {
      toast({ title: "Auto-tune failed", description: error.message, variant: "destructive" });
      return;
    }
    const rows = (data ?? []).filter((r: any) => {
      const t = r.audio_sources?.source_type as string | undefined;
      if (!t) return false;
      return types ? types.includes(t) : !["intuizi", "ctv"].includes(t);
    });
    const samples = rows.map((r: any) => {
      const rawObj = r.raw_scores as Record<string, number> | null;
      const hasRaw =
        !!rawObj && CATEGORIES.some((c) => typeof rawObj[c] === "number");
      const scores = {} as Record<Category, number>;
      for (const c of CATEGORIES) {
        scores[c] = hasRaw
          ? Number(rawObj?.[c] ?? 0)
          : Number(r[`${c}_score`] ?? 0);
      }
      return { scores, isRaw: hasRaw };
    });
    const result = computeAutoTune(samples, cfg?.redistribute !== false);
    if (!result) {
      toast({
        title: "Nothing to tune yet",
        description: `No recent analyses found for the "${scope}" scope.`,
      });
      return;
    }
    setTune(result);
  }, [scope, cfg?.redistribute]);

  useEffect(() => {
    setTune(null);
  }, [scope]);



  const load = useCallback(async (s: string) => {
    setLoading(true);
    const { data, error } = await supabase
      .from("semantic_normalization")
      .select("scope,enabled,speech_bias,redistribute,gains")
      .eq("scope", s)
      .maybeSingle();
    if (error) toast({ title: "Could not load normalization settings", variant: "destructive" });
    setCfg({
      scope: s,
      enabled: data ? !!data.enabled : false,
      speech_bias: data ? Number(data.speech_bias) || 0 : 0,
      redistribute: data ? data.redistribute !== false : true,
      gains: { ...DEFAULT_GAINS, ...((data?.gains as Record<string, number>) ?? {}) },
    });
    setLoading(false);
  }, []);

  useEffect(() => {
    load(scope);
  }, [scope, load]);

  const save = async () => {
    if (!cfg) return;
    setSaving(true);
    const { error } = await supabase
      .from("semantic_normalization")
      .upsert(
        {
          scope: cfg.scope,
          enabled: cfg.enabled,
          speech_bias: cfg.speech_bias,
          redistribute: cfg.redistribute,
          gains: cfg.gains,
        },
        { onConflict: "scope" },
      );
    setSaving(false);
    if (error) {
      toast({
        title: "Save failed",
        description: error.message.includes("policy")
          ? "Admin role required to change normalization settings."
          : error.message,
        variant: "destructive",
      });
      return;
    }
    toast({ title: `Normalization saved for "${cfg.scope}"` });
  };

  /** Baseline sample: the selected activation, else a speech-skewed archetype. */
  const raw = useMemo(() => {
    const base: Record<Category, number> = {
      emotional: 38,
      cognitive: 52,
      social: 44,
      communication: 78,
      contextual: 46,
      artistic: 31,
    };
    if (!sample) return base;
    const out = { ...base };
    for (const c of CATEGORIES) {
      const v = sample[c];
      if (typeof v === "number") out[c] = v;
    }
    return out;
  }, [sample]);

  const preview = useMemo(
    () => (cfg ? normalizeScores(raw, cfg) : raw),
    [raw, cfg],
  );

  const impact = useMemo(
    () =>
      cfg
        ? explainNormalization(raw, cfg)
        : { rows: [], removed: 0, redistributed: 0, enabled: false },
    [raw, cfg],
  );


  const dominant = useMemo(() => {
    const pick = (m: Record<Category, number>) =>
      CATEGORIES.reduce((a, b) => ((m[b] ?? 0) > (m[a] ?? 0) ? b : a), CATEGORIES[0]);
    return { before: pick(raw), after: pick(preview) };
  }, [raw, preview]);

  return (
    <Card className="border-primary/20 bg-card/70 p-5 backdrop-blur-sm">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <div className="rounded-md bg-primary/15 p-1.5">
            <Mic className="h-4 w-4 text-primary" />
          </div>
          <div>
            <h2 className="text-sm font-semibold">Spoken-word normalization</h2>
            <p className="text-xs text-muted-foreground">
              Corrects vocal / dialogue skew across all six ontology categories before scores are
              learned from.
            </p>
          </div>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Select value={scope} onValueChange={setScope}>
            <SelectTrigger className="h-8 w-[190px] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SCOPES.map((s) => (
                <SelectItem key={s.value} value={s.value} className="text-xs">
                  {s.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {loading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
        </div>
      </div>

      {cfg && (
        <>
          <p className="mt-2 text-[11px] text-muted-foreground">
            {SCOPES.find((s) => s.value === scope)?.hint}
          </p>

          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <NormalizationControls
              cfg={cfg}
              setCfg={setCfg}
              saving={saving}
              save={save}
              scope={scope}
              load={load}
              runAutoTune={runAutoTune}
              tuning={tuning}
              tune={tune}
              setTune={setTune}
            />

            <LivePreview
              raw={raw}
              preview={preview}
              sampleLabel={sampleLabel}
              dominant={dominant}
            />
          </div>


          <ImpactBreakdown cfg={cfg} impact={impact} sampleLabel={sampleLabel} />


          <p className="mt-3 text-[11px] text-muted-foreground">
            Applied inside the ingest pipeline right after scoring: raw model scores are retained on
            each analysis for audit, the normalized profile becomes the stored result, and
            calibration learns from the corrected values so the vocal bias is not relearned.
          </p>
        </>
      )}
    </Card>
  );
};

export default SpeechNormalizationPanel;
