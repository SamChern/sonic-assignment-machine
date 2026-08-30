import { Card } from "@/components/ui/card";

export interface QuadrantPoint {
  id: string;
  title: string;
  divergence: number | null;
  resonance: number | null;
}

const S = 260;
const PAD = 26;

const pos = (v: number | null) => PAD + (Math.min(1, Math.max(0, v ?? 0)) * (S - 2 * PAD));

/**
 * Step 17a — divergence with coherence: novelty on x, resonance on y. This is
 * distance in a learned space, not a judgement of artistic worth, and the caption
 * says so on the surface.
 */
export const DivergenceQuadrant = ({ points }: { points: QuadrantPoint[] }) => (
  <Card className="border-border/60 bg-card/70 p-4 backdrop-blur-sm">
    <h3 className="text-sm font-semibold">Divergence with coherence</h3>
    <p className="mb-3 text-xs text-muted-foreground">
      Novelty against resonance. Distance in a learned space — not a measure of artistic worth.
    </p>
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${S} ${S}`} className="h-[260px] w-[260px]" role="img" aria-label="Divergence versus resonance">
        <rect x={PAD} y={PAD} width={S - 2 * PAD} height={S - 2 * PAD} fill="hsl(var(--muted)/0.25)" rx="8" />
        <line x1={S / 2} y1={PAD} x2={S / 2} y2={S - PAD} stroke="hsl(var(--border))" />
        <line x1={PAD} y1={S / 2} x2={S - PAD} y2={S / 2} stroke="hsl(var(--border))" />
        {[
          ["Familiar", PAD + 6, S / 2 - 8, "start"],
          ["Original", S - PAD - 6, S / 2 - 8, "end"],
          ["Derivative", PAD + 6, S / 2 + 16, "start"],
          ["Inaccessible", S - PAD - 6, S / 2 + 16, "end"],
        ].map(([label, x, y, anchor]) => (
          <text
            key={label as string}
            x={x as number}
            y={y as number}
            textAnchor={anchor as string}
            className="fill-muted-foreground"
            style={{ fontSize: 9 }}
          >
            {label}
          </text>
        ))}
        {points.map((p) => (
          <g key={p.id}>
            <circle
              cx={pos(p.divergence)}
              cy={S - pos(p.resonance)}
              r={5}
              fill="hsl(var(--primary))"
              opacity={0.85}
            />
            <title>{`${p.title} — divergence ${(p.divergence ?? 0).toFixed(2)}, resonance ${(p.resonance ?? 0).toFixed(2)}`}</title>
          </g>
        ))}
        <text x={S / 2} y={S - 6} textAnchor="middle" className="fill-muted-foreground" style={{ fontSize: 9 }}>
          divergence →
        </text>
      </svg>
    </div>
  </Card>
);

export default DivergenceQuadrant;
