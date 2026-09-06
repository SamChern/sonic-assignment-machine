import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Loader2, RotateCcw, Save, Wand2 } from "lucide-react";
import { CATEGORIES, DEFAULT_GAINS, type AutoTuneResult, type Cfg } from "@/lib/speechNormalization";

interface Props {
  cfg: Cfg;
  setCfg: (cfg: Cfg) => void;
  saving: boolean;
  save: () => void;
  scope: string;
  load: (s: string) => void;
  runAutoTune: () => void;
  tuning: boolean;
  tune: AutoTuneResult | null;
  setTune: (t: AutoTuneResult | null) => void;
}

const NormalizationControls = ({
  cfg,
  setCfg,
  saving,
  save,
  scope,
  load,
  runAutoTune,
  tuning,
  tune,
  setTune,
}: Props) => {
  return (
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
        <Button size="sm" variant="outline" onClick={runAutoTune} disabled={tuning}>
          {tuning ? (
            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
          ) : (
            <Wand2 className="mr-1.5 h-3.5 w-3.5" />
          )}
          Auto-tune
        </Button>
      </div>

      {tune && (
        <div className="rounded-md border border-primary/30 bg-primary/5 p-3">
          <div className="flex flex-wrap items-center gap-2 text-[11px]">
            <span className="text-xs font-medium">Recommendation</span>
            <Badge variant="outline" className="font-mono">
              {tune.sampleSize} recent analyses
            </Badge>
            <Badge variant="outline" className="font-mono">
              {tune.usedRaw > 0 ? `${tune.usedRaw} with raw scores` : "stored profiles only"}
            </Badge>
            <span className="ml-auto font-mono text-primary">
              strength {tune.speech_bias.toFixed(2)}
            </span>
          </div>

          <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] sm:grid-cols-3">
            {CATEGORIES.map((c) => (
              <div key={c} className="flex items-center justify-between gap-2">
                <span className="capitalize text-muted-foreground">{c}</span>
                <span className="font-mono">
                  {Math.round(tune.means[c])} → {Math.round(tune.tuned[c] ?? 0)}
                  <span className="ml-1 text-primary">
                    {(tune.gains[c] ?? 1).toFixed(2)}×
                  </span>
                </span>
              </div>
            ))}
          </div>

          {tune.notes.map((n) => (
            <p key={n} className="mt-1.5 text-[11px] text-muted-foreground">
              {n}
            </p>
          ))}

          <div className="mt-2 flex gap-2">
            <Button
              size="sm"
              onClick={() =>
                setCfg({
                  ...cfg,
                  enabled: true,
                  speech_bias: tune.speech_bias,
                  gains: { ...cfg.gains, ...tune.gains },
                })
              }
            >
              Apply recommendation
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setTune(null)}>
              Dismiss
            </Button>
          </div>
          <p className="mt-1.5 text-[11px] text-muted-foreground">
            Applying only fills the controls — press “Save settings” to persist it for this
            scope.
          </p>
        </div>
      )}
    </div>
  );
};

export default NormalizationControls;
