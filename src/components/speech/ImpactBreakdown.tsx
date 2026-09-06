import { Badge } from "@/components/ui/badge";
import { Scale } from "lucide-react";
import { GRADIENTS, type Cfg, type ImpactRow } from "@/lib/speechNormalization";

interface Props {
  cfg: Cfg;
  impact: { rows: ImpactRow[]; removed: number; redistributed: number; enabled: boolean };
  sampleLabel?: string;
}

const ImpactBreakdown = ({ cfg, impact, sampleLabel }: Props) => {
  return (
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
  );
};

export default ImpactBreakdown;
