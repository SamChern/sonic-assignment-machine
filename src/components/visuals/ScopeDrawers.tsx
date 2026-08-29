/**
 * Semantic Scope drawers — the legend (all roles) and the admin debug lens.
 * Split out of `SemanticScope` so the instrument itself stays readable.
 */
import type { ScopeDebug } from "@/hooks/useScopeWindowScore";

export const ScopeLegend = ({
  windowSeconds,
  isSilhouette,
}: {
  windowSeconds: number;
  isSilhouette: boolean;
}) => (
  <div className="grid gap-3 rounded-xl border border-border/60 bg-background/60 p-3 text-[11px] leading-relaxed text-muted-foreground sm:grid-cols-3">
    <div>
      <p className="mb-1 font-semibold text-foreground">Time lens</p>
      <p>
        The waveform: amplitude over time, one harmonic band per ontology category. The strip below
        it is the <strong>tag-fire trail</strong> — every marker is a scored window you can scrub
        back to.
      </p>
    </div>
    <div>
      <p className="mb-1 font-semibold text-foreground">Frequency lens</p>
      <p>
        The strip scrolls right to left — low frequencies at the bottom, colored by the category band
        they feed. The teal trace is <strong>energy</strong> (RMS), the grey one{" "}
        <strong>brightness</strong> (spectral centroid). Vertical ticks mark windows that produced a
        tag.
      </p>
    </div>
    <div>
      <p className="mb-1 font-semibold text-foreground">Meaning lens</p>
      <p>
        Every {windowSeconds} seconds the current window is embedded and matched against the
        taxonomy; the nearest tags light up with their similarity and the radial morphs.
        {isSilhouette
          ? " With no audio, the trace is the subject's expected silhouette synthesized from their tag-weighted embedding."
          : ""}
      </p>
    </div>
  </div>
);

export const ScopeDebugDrawer = ({ debug }: { debug: ScopeDebug | null }) => (
  <div className="rounded-xl border border-primary/40 bg-primary/5 p-3 text-[11px] text-muted-foreground">
    <p className="mb-1 font-semibold text-foreground">Debug lens</p>
    {debug ? (
      <div className="grid gap-2 sm:grid-cols-2">
        <div>
          <p>
            kNN k = <span className="text-foreground">{debug.knn_k}</span> · prior blend ={" "}
            <span className="text-foreground">{debug.prior_blend_weight}</span> · bridge ={" "}
            <span className="text-foreground">{debug.bridge_active_id ?? "none"}</span>
          </p>
          <p className="mt-1">
            window RMS <span className="text-foreground">{debug.features.rms.toFixed(3)}</span> ·
            centroid{" "}
            <span className="text-foreground">{Math.round(debug.features.centroidHz)} Hz</span>
          </p>
        </div>
        <ul className="space-y-0.5">
          {debug.neighbors.slice(0, 8).map((n) => (
            <li key={n.id ?? n.code} className="flex justify-between gap-2">
              <span className="truncate font-mono text-[10px]">{n.code}</span>
              <span className="tabular-nums text-foreground">{n.similarity.toFixed(3)}</span>
            </li>
          ))}
        </ul>
      </div>
    ) : (
      <p>No scored window yet — press play to retrieve neighbors.</p>
    )}
  </div>
);
