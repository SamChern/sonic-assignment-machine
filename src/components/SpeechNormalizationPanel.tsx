import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { toast } from "@/hooks/use-toast";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, Mic, RotateCcw, Save, Scale, Sparkles } from "lucide-react";

/* ------------------------------------------------------------------ shared */

const CATEGORIES = [
  "emotional",
  "cognitive",
  "social",
  "communication",
  "contextual",
  "artistic",
] as const;
type Category = (typeof CATEGORIES)[number];

/** Share of each category treated as speech-driven inflation (mirrors backend). */
const SPEECH_LOAD: Record<Category, number> = {
  emotional: 0.05,
  cognitive: 0.2,
  social: 0.1,
  communication: 0.6,
  contextual: 0.05,
  artistic: 0.15,
};

const GRADIENTS: Record<Category, string> = {
  emotional: "var(--gradient-emotional)",
  cognitive: "var(--gradient-cognitive)",
  social: "var(--gradient-social)",
  communication: "var(--gradient-communication)",
  contextual: "var(--gradient-contextual)",
  artistic: "var(--gradient-artistic)",
};

const clamp = (n: number) => Math.max(0, Math.min(100, n));

/** Client mirror of the edge-function normalization math. */
export function normalizeScores(
  raw: Record<Category, number>,
  cfg: { enabled: boolean; speech_bias: number; redistribute: boolean; gains: Record<string, number> },
): Record<Category, number> {
  const out = {} as Record<Category, number>;
  if (!cfg.enabled) {
    for (const c of CATEGORIES) out[c] = clamp(raw[c] ?? 0);
    return out;
  }
  const bias = Math.max(0, Math.min(1, cfg.speech_bias));
  const damped = {} as Record<Category, number>;
  let removed = 0;
  for (const c of CATEGORIES) {
    const v = raw[c] ?? 0;
    const cut = v * bias * SPEECH_LOAD[c];
    damped[c] = v - cut;
    removed += cut;
  }
  if (cfg.redistribute && removed > 0) {
    let total = 0;
    const w = {} as Record<Category, number>;
    for (const c of CATEGORIES) {
      w[c] = damped[c] * (1 - SPEECH_LOAD[c]);
      total += w[c];
    }
    if (total > 0) for (const c of CATEGORIES) damped[c] += removed * (w[c] / total);
  }
  for (const c of CATEGORIES) {
    out[c] = Math.round(clamp(damped[c] * (cfg.gains?.[c] ?? 1)) * 10) / 10;
  }
  return out;
}

export interface ImpactRow {
  category: Category;
  raw: number;
  damped: number;
  /** Points removed by speech damping (negative number). */
  cut: number;
  /** Points handed back by redistribution. */
  given: number;
  /** Points added/removed by the per-category gain. */
  gainDelta: number;
  final: number;
  net: number;
  speechLoad: number;
}

/** Stage-by-stage explanation of what normalization did to each category. */
export function explainNormalization(
  raw: Record<Category, number>,
  cfg: { enabled: boolean; speech_bias: number; redistribute: boolean; gains: Record<string, number> },
): { rows: ImpactRow[]; removed: number; redistributed: number; enabled: boolean } {
  if (!cfg.enabled) {
    return {
      enabled: false,
      removed: 0,
      redistributed: 0,
      rows: CATEGORIES.map((c) => ({
        category: c,
        raw: clamp(raw[c] ?? 0),
        damped: clamp(raw[c] ?? 0),
        cut: 0,
        given: 0,
        gainDelta: 0,
        final: clamp(raw[c] ?? 0),
        net: 0,
        speechLoad: SPEECH_LOAD[c],
      })),
    };
  }

  const bias = Math.max(0, Math.min(1, cfg.speech_bias));
  const cut = {} as Record<Category, number>;
  const damped = {} as Record<Category, number>;
  let removed = 0;
  for (const c of CATEGORIES) {
    const v = raw[c] ?? 0;
    cut[c] = v * bias * SPEECH_LOAD[c];
    damped[c] = v - cut[c];
    removed += cut[c];
  }

  const given = {} as Record<Category, number>;
  for (const c of CATEGORIES) given[c] = 0;
  let redistributed = 0;
  if (cfg.redistribute && removed > 0) {
    let total = 0;
    const w = {} as Record<Category, number>;
    for (const c of CATEGORIES) {
      w[c] = damped[c] * (1 - SPEECH_LOAD[c]);
      total += w[c];
    }
    if (total > 0) {
      for (const c of CATEGORIES) {
        given[c] = removed * (w[c] / total);
        redistributed += given[c];
      }
    }
  }

  const rows = CATEGORIES.map((c) => {
    const preGain = damped[c] + given[c];
    const final = Math.round(clamp(preGain * (cfg.gains?.[c] ?? 1)) * 10) / 10;
    return {
      category: c,
      raw: raw[c] ?? 0,
      damped: damped[c],
      cut: -cut[c],
      given: given[c],
      gainDelta: final - clamp(preGain),
      final,
      net: final - (raw[c] ?? 0),
      speechLoad: SPEECH_LOAD[c],
    };
  });

  return { rows, removed, redistributed, enabled: true };
}



interface Cfg {
  scope: string;
  enabled: boolean;
  speech_bias: number;
  redistribute: boolean;
  gains: Record<string, number>;
}

const DEFAULT_GAINS: Record<string, number> = {
  emotional: 1,
  cognitive: 1,
  social: 1,
  communication: 1,
  contextual: 1,
  artistic: 1,
};

const SCOPES: { value: string; label: string; hint: string }[] = [
  { value: "intuizi", label: "Intuizi feeds", hint: "CTV + audio-app device streams from Intuizi" },
  { value: "ctv", label: "CTV batches", hint: "Admin-submitted CTV ingest batches" },
  { value: "global", label: "Global default", hint: "Fallback for music / file uploads" },
];

/* --------------------------------------------------------------- component */

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
            {/* controls */}
            <div className="space-y-4 rounded-lg border border-border bg-background/40 p-4">
              <div className="flex items-center justify-between">
                <Label htmlFor="norm-enabled" className="text-xs font-medium">
                  Normalization enabled
                </Label>
                <Switch
                  id="norm-enabled"
                  checked={cfg.enabled}
                  onCheckedChange={(v) => setCfg({ ...cfg, enabled: v })}
                />
              </div>

              <div>
                <div className="flex items-center justify-between text-xs">
                  <Label className="font-medium">Speech-skew strength</Label>
                  <span className="font-mono text-primary">{cfg.speech_bias.toFixed(2)}</span>
                </div>
                <Slider
                  className="mt-2"
                  min={0}
                  max={1}
                  step={0.05}
                  value={[cfg.speech_bias]}
                  onValueChange={([v]) => setCfg({ ...cfg, speech_bias: v })}
                  disabled={!cfg.enabled}
                />
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Damps each category by strength × its speech load (Communication 0.60, Cognitive
                  0.20, Artistic 0.15, Social 0.10, Emotional / Contextual 0.05).
                </p>
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <Label htmlFor="norm-redist" className="text-xs font-medium">
                    Redistribute removed points
                  </Label>
                  <p className="text-[11px] text-muted-foreground">
                    Hands the damped points back on residual (non-speech) weight so overall energy
                    holds.
                  </p>
                </div>
                <Switch
                  id="norm-redist"
                  checked={cfg.redistribute}
                  onCheckedChange={(v) => setCfg({ ...cfg, redistribute: v })}
                  disabled={!cfg.enabled}
                />
              </div>

              <div>
                <Label className="text-xs font-medium">Per-category gain</Label>
                <div className="mt-2 space-y-2">
                  {CATEGORIES.map((c) => (
                    <div key={c} className="flex items-center gap-2">
                      <span className="w-24 shrink-0 text-[11px] capitalize text-muted-foreground">
                        {c}
                      </span>
                      <Slider
                        min={0.5}
                        max={1.5}
                        step={0.05}
                        value={[cfg.gains[c] ?? 1]}
                        onValueChange={([v]) =>
                          setCfg({ ...cfg, gains: { ...cfg.gains, [c]: v } })
                        }
                        disabled={!cfg.enabled}
                      />
                      <span className="w-10 shrink-0 text-right font-mono text-[11px]">
                        {(cfg.gains[c] ?? 1).toFixed(2)}×
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex gap-2 pt-1">
                <Button size="sm" onClick={save} disabled={saving}>
                  {saving ? (
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Save className="mr-1.5 h-3.5 w-3.5" />
                  )}
                  Save settings
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setCfg({ ...cfg, speech_bias: 0.5, redistribute: true, gains: { ...DEFAULT_GAINS } })}
                >
                  <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
                  Reset
                </Button>
                <Button size="sm" variant="ghost" onClick={() => load(scope)}>
                  Revert
                </Button>
              </div>
            </div>

            {/* live preview */}
            <div className="rounded-lg border border-border bg-background/40 p-4">
              <div className="flex items-center gap-1.5 text-xs font-medium">
                <Sparkles className="h-3.5 w-3.5 text-primary" />
                Live preview
                <span className="ml-auto text-[11px] font-normal text-muted-foreground">
                  {sampleLabel ?? "speech-skewed archetype"}
                </span>
              </div>

              <div className="mt-3 space-y-2.5">
                {CATEGORIES.map((c) => {
                  const a = raw[c] ?? 0;
                  const b = preview[c] ?? 0;
                  const d = b - a;
                  return (
                    <div key={c}>
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="capitalize">{c}</span>
                        <span className="font-mono">
                          {Math.round(a)} → {Math.round(b)}{" "}
                          <span className={d > 0 ? "text-primary" : d < 0 ? "text-destructive" : "text-muted-foreground"}>
                            ({d > 0 ? "+" : ""}
                            {d.toFixed(1)})
                          </span>
                        </span>
                      </div>
                      <div className="mt-1 h-2 overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full rounded-full transition-all"
                          style={{ width: `${clamp(b)}%`, background: GRADIENTS[c] }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-2 rounded-md border border-border bg-card/60 px-3 py-2 text-[11px]">
                <span className="text-muted-foreground">Dominant category</span>
                <Badge variant="secondary" className="capitalize">
                  {dominant.before}
                </Badge>
                <span className="text-muted-foreground">→</span>
                <Badge className="capitalize">{dominant.after}</Badge>
                {dominant.before !== dominant.after && (
                  <span className="text-primary">label flips under these settings</span>
                )}
              </div>
          </div>

          {/* impact breakdown */}
          <div className="mt-4 rounded-lg border border-border bg-background/40 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-1.5 text-xs font-medium">
                <Scale className="h-3.5 w-3.5 text-primary" />
                Impact breakdown
              </div>
              <span className="text-[11px] text-muted-foreground">
                {sampleLabel ?? "speech-skewed archetype"}
              </span>
              <div className="ml-auto flex flex-wrap items-center gap-2 text-[11px]">
                <Badge variant="outline" className="font-mono">
                  damped −{impact.removed.toFixed(1)} pts
                </Badge>
                <Badge variant="outline" className="font-mono">
                  {cfg.redistribute
                    ? `redistributed +${impact.redistributed.toFixed(1)} pts`
                    : "redistribution off"}
                </Badge>
                {!impact.enabled && (
                  <Badge variant="secondary">normalization disabled — no impact</Badge>
                )}
              </div>
            </div>

            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[560px] text-[11px]">
                <thead>
                  <tr className="text-left text-muted-foreground">
                    <th className="py-1.5 pr-3 font-medium">Category</th>
                    <th className="py-1.5 pr-3 font-medium">Speech load</th>
                    <th className="py-1.5 pr-3 text-right font-medium">Raw</th>
                    <th className="py-1.5 pr-3 text-right font-medium">Damping</th>
                    <th className="py-1.5 pr-3 text-right font-medium">Redistributed</th>
                    <th className="py-1.5 pr-3 text-right font-medium">Gain</th>
                    <th className="py-1.5 pr-3 text-right font-medium">Final</th>
                    <th className="py-1.5 text-right font-medium">Net</th>
                  </tr>
                </thead>
                <tbody>
                  {impact.rows.map((r) => (
                    <tr key={r.category} className="border-t border-border/60">
                      <td className="py-1.5 pr-3">
                        <span className="flex items-center gap-1.5 capitalize">
                          <span
                            className="h-2 w-2 rounded-full"
                            style={{ background: GRADIENTS[r.category] }}
                          />
                          {r.category}
                        </span>
                      </td>
                      <td className="py-1.5 pr-3 font-mono text-muted-foreground">
                        {r.speechLoad.toFixed(2)}
                      </td>
                      <td className="py-1.5 pr-3 text-right font-mono">{Math.round(r.raw)}</td>
                      <td className="py-1.5 pr-3 text-right font-mono text-destructive">
                        {r.cut < 0 ? r.cut.toFixed(1) : "0.0"}
                      </td>
                      <td className="py-1.5 pr-3 text-right font-mono text-primary">
                        {r.given > 0 ? `+${r.given.toFixed(1)}` : "—"}
                      </td>
                      <td className="py-1.5 pr-3 text-right font-mono text-muted-foreground">
                        {Math.abs(r.gainDelta) < 0.05
                          ? "—"
                          : `${r.gainDelta > 0 ? "+" : ""}${r.gainDelta.toFixed(1)}`}
                      </td>
                      <td className="py-1.5 pr-3 text-right font-mono">{r.final.toFixed(1)}</td>
                      <td
                        className={`py-1.5 text-right font-mono ${
                          r.net > 0.05
                            ? "text-primary"
                            : r.net < -0.05
                              ? "text-destructive"
                              : "text-muted-foreground"
                        }`}
                      >
                        {r.net > 0 ? "+" : ""}
                        {r.net.toFixed(1)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <p className="mt-2 text-[11px] text-muted-foreground">
              Damping = raw × strength ({cfg.speech_bias.toFixed(2)}) × speech load. Redistributed
              points are shared on residual non-speech weight, then the per-category gain is applied
              last. Net is the total shift the stored profile sees.
            </p>
          </div>


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
