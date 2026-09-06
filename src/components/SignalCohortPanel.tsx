import { ServerCohortPanel } from "@/components/admin/ServerCohortPanel";
import { lazy, Suspense, useMemo, useState } from "react";

const SignatureCard = lazy(() =>
  import("@/components/SignatureCard").then((m) => ({ default: m.SignatureCard })),
);

import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import {
  Radio,
  Layers,
  ChevronDown,
  ChevronRight,
  Fingerprint,
  ShieldCheck,
  Hash,
  Eye,
  EyeOff,
} from "lucide-react";
import {
  CATEGORY_KEYS,
  suggestedK,
  type MetaFingerprint,
  type SignalCohort,
  type SignalPoint,
} from "@/lib/identifierSignals";

const CATEGORY_META = [
  { name: "Emotional", color: "hsl(var(--category-emotional))" },
  { name: "Cognitive", color: "hsl(var(--category-cognitive))" },
  { name: "Social", color: "hsl(var(--category-social))" },
  { name: "Communication", color: "hsl(var(--category-communication))" },
  { name: "Contextual", color: "hsl(var(--category-contextual))" },
  { name: "Artistic", color: "hsl(var(--category-contextual))" },
];

const COHORT_COLORS = ["hsl(var(--chart-1))", "hsl(var(--chart-2))", "hsl(var(--chart-3))", "hsl(var(--chart-4))", "hsl(var(--chart-5))", "hsl(var(--category-social))", "hsl(var(--category-artistic))", "hsl(var(--category-contextual))"];

const BASIS_LABEL: Record<SignalPoint["basis"], string> = {
  scored: "scored by ingest",
  inherited: "inherited from linked source",
  "facet-only": "facet-only estimate",
};

function ScoreBars({ vector, compact = false }: { vector: number[]; compact?: boolean }) {
  return (
    <div className={compact ? "grid gap-1" : "grid gap-1.5"}>
      {vector.map((v, i) => (
        <div key={CATEGORY_KEYS[i]} className="flex items-center gap-2">
          <span className={`${compact ? "w-20 text-[10px]" : "w-28 text-xs"} shrink-0 text-muted-foreground`}>
            {CATEGORY_META[i].name}
          </span>
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full transition-all"
              style={{ width: `${Math.max(2, v)}%`, backgroundColor: CATEGORY_META[i].color }}
            />
          </div>
          <span className={`${compact ? "text-[10px]" : "text-xs"} w-7 shrink-0 text-right font-mono text-foreground`}>
            {Math.round(v)}
          </span>
        </div>
      ))}
    </div>
  );
}

interface SignalCohortPanelProps {
  points: SignalPoint[];
  cohorts: SignalCohort[];
  meta: MetaFingerprint | null;
  cohortCount: number;
  onCohortCountChange: (k: number) => void;
  selectedCohortKeys: string[];
  onToggleCohort: (key: string) => void;
  loading?: boolean;
}

const MEMBER_PAGE = 24;

function IdentifierSignals({
  points,
  cohorts,
  meta,
  cohortCount,
  onCohortCountChange,
  selectedCohortKeys,
  onToggleCohort,
  loading,
}: SignalCohortPanelProps) {
  const [expanded, setExpanded] = useState<string[]>([]);
  const [memberLimit, setMemberLimit] = useState<Record<string, number>>({});
  const [showIdentifierLevel, setShowIdentifierLevel] = useState(true);

  const recommended = useMemo(() => suggestedK(points.length), [points.length]);
  const scoredCount = useMemo(() => points.filter((p) => p.basis === "scored").length, [points]);

  const toggleExpanded = (key: string) =>
    setExpanded((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));

  if (loading) {
    return (
      <Card className="p-8 text-center bg-card/80">
        <Radio className="mx-auto mb-3 h-10 w-10 animate-pulse text-muted-foreground" />
        <p className="text-sm text-muted-foreground">Loading identifier-level signals…</p>
      </Card>
    );
  }

  if (!points.length) {
    return (
      <Card className="p-8 text-center bg-card/80">
        <Radio className="mx-auto mb-3 h-10 w-10 text-muted-foreground" />
        <p className="text-lg text-muted-foreground">No identifier-level signals ingested yet</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Run an Intuizi ingest to populate device- and audience-level signals.
        </p>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Meta rollup */}
      {meta && (
        <Card className="p-6 bg-card/80">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              <div className="gradient-primary flex h-11 w-11 items-center justify-center rounded-lg">
                <Fingerprint className="h-6 w-6 text-primary-foreground" />
              </div>
              <div>
                <h3 className="font-semibold text-foreground">Meta sonic fingerprint</h3>
                <p className="text-sm text-muted-foreground">
                  {meta.identifierCount.toLocaleString()} identifiers rolled up through {meta.cohortCount} cohort
                  {meta.cohortCount !== 1 ? "s" : ""}, weighted by cohort size
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <Badge variant="secondary" className="gap-1">
                    <ShieldCheck className="h-3 w-3" />
                    {(meta.fingerprint_confidence * 100).toFixed(0)}% confidence
                  </Badge>
                  <Badge variant="outline">Cohort spread {meta.dispersionPct}%</Badge>
                  <Badge variant="outline">
                    {scoredCount.toLocaleString()} of {points.length.toLocaleString()} directly scored
                  </Badge>
                </div>
              </div>
            </div>
            <div className="w-full max-w-sm space-y-3">
              <ScoreBars
                vector={[
                  meta.emotional_avg,
                  meta.cognitive_avg,
                  meta.social_avg,
                  meta.communication_avg,
                  meta.contextual_avg,
                  meta.artistic_avg,
                ]}
              />
              {/* Step 15 — the Ensemble archetype and its anchors for the rolled-up
                  Intuizi signal, so meta fingerprints read like any other analysis. */}
              <Suspense fallback={<div className="h-24 animate-pulse rounded-lg bg-muted/40" />}>
                <SignatureCard
                  compact
                  className="w-full"
                  subjectRef={`intuizi-meta-${meta.identifierCount}-${meta.cohortCount}`}
                  vector={{
                    emotional: meta.emotional_avg,
                    cognitive: meta.cognitive_avg,
                    social: meta.social_avg,
                    communication: meta.communication_avg,
                    contextual: meta.contextual_avg,
                    artistic: meta.artistic_avg,
                  }}
                />
              </Suspense>
            </div>
          </div>
        </Card>
      )}


      {/* Cohort controls */}
      <Card className="p-4 bg-card/80">
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
            <Layers className="h-4 w-4" />
            Sub-clusters
          </div>
          <div className="flex min-w-[220px] flex-1 items-center gap-3">
            <Slider
              value={[cohortCount]}
              min={2}
              max={8}
              step={1}
              onValueChange={([v]) => onCohortCountChange(v)}
            />
            <span className="w-6 text-right font-mono text-sm text-foreground">{cohortCount}</span>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onCohortCountChange(recommended)}
            disabled={cohortCount === recommended}
          >
            Reset to {recommended}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={() => setShowIdentifierLevel((v) => !v)}
          >
            {showIdentifierLevel ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
            {showIdentifierLevel ? "Hide" : "Show"} identifier level
          </Button>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          Identifiers are pseudonymized — raw identifier values are never displayed. Cohorts are first
          partitioned by activation and feed scope, then split further only where per-identifier signals
          actually differ.
        </p>
        {cohorts.length < cohortCount && (
          <p className="mt-1 text-xs text-amber-500">
            Only {cohorts.length} cohort{cohorts.length !== 1 ? "s" : ""} available: the remaining
            identifiers share identical signals, so the feed carries no detail to split them further.
          </p>
        )}
      </Card>

      {/* Cohorts */}
      {cohorts.map((cohort, idx) => {
        const color = COHORT_COLORS[idx % COHORT_COLORS.length];
        const isOpen = expanded.includes(cohort.key);
        const isSelected = selectedCohortKeys.includes(cohort.key);
        const limit = memberLimit[cohort.key] ?? MEMBER_PAGE;

        return (
          <Card
            key={cohort.key}
            className="p-5 bg-card/80"
            style={isSelected ? { borderColor: color } : undefined}
          >
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="flex items-start gap-3">
                <div
                  className="flex h-11 w-11 items-center justify-center rounded-lg text-sm font-bold text-background"
                  style={{ backgroundColor: color }}
                >
                  {cohort.letter}
                </div>
                <div>
                  <h4 className="font-semibold text-foreground">{cohort.label}</h4>
                  <p className="text-sm text-muted-foreground">
                    {cohort.members.length.toLocaleString()} identifiers ·{" "}
                    {(cohort.share * 100).toFixed(1)}% of population ·{" "}
                    {cohort.observations.toLocaleString()} observations
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    <Badge variant="secondary">{cohort.dominantCategory}-led</Badge>
                    <Badge variant="outline">Cohesion {(cohort.cohesion * 100).toFixed(0)}%</Badge>
                    <Badge variant="outline">Confidence {(cohort.avgConfidence * 100).toFixed(0)}%</Badge>
                    {cohort.undifferentiated && cohort.members.length > 1 && (
                      <Badge variant="outline" className="text-amber-500">
                        Uniform signals — not splittable
                      </Badge>
                    )}
                    {cohort.topFacets.map((f) => (
                      <Badge key={f.label} variant="outline" className="gap-1 text-[11px]">
                        <Hash className="h-3 w-3" />
                        {f.label} ({f.count})
                      </Badge>
                    ))}
                  </div>
                </div>
              </div>

              <div className="w-full max-w-sm">
                <ScoreBars vector={cohort.centroid} compact />
              </div>
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-2">
              <Button
                variant={isSelected ? "default" : "outline"}
                size="sm"
                onClick={() => onToggleCohort(cohort.key)}
              >
                {isSelected ? "Remove from scope" : "Scope to this cohort"}
              </Button>
              {showIdentifierLevel && (
                <Button variant="ghost" size="sm" className="gap-1" onClick={() => toggleExpanded(cohort.key)}>
                  {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                  {isOpen ? "Hide" : "Show"} identifier signals
                </Button>
              )}
            </div>

            {showIdentifierLevel && isOpen && (
              <div className="mt-4 space-y-3">
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {cohort.members.slice(0, limit).map((m) => (
                    <div key={m.id} className="rounded-md border border-border bg-background/40 p-3">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono text-xs text-foreground">{m.label}</span>
                        <Badge variant="outline" className="text-[10px]">
                          {BASIS_LABEL[m.basis]}
                        </Badge>
                      </div>
                      <div className="mt-2">
                        <ScoreBars vector={m.vector} compact />
                      </div>
                      <div className="mt-2 flex flex-wrap gap-1">
                        {m.facets.slice(0, 3).map((f) => (
                          <Badge key={`${f.kind}-${f.label}`} variant="secondary" className="text-[10px]">
                            {f.label}
                          </Badge>
                        ))}
                        {m.facets.length === 0 && (
                          <span className="text-[10px] text-muted-foreground">no facet signals</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
                {cohort.members.length > limit && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      setMemberLimit((prev) => ({ ...prev, [cohort.key]: limit + MEMBER_PAGE * 2 }))
                    }
                  >
                    Show more ({(cohort.members.length - limit).toLocaleString()} remaining)
                  </Button>
                )}
              </div>
            )}
          </Card>
        );
      })}
    </div>
  );
}

/**
 * Step 6 surface: identifier-level sub-clustering on top, and the server-side
 * sonic cohorts with their Activation-file export history underneath. Neither
 * half ever receives an EID or a raw subject key — the server cohort tables are
 * aggregate-only by policy.
 */
export function SignalCohortPanel(props: SignalCohortPanelProps) {
  return (
    <div className="space-y-6">
      <IdentifierSignals {...props} />
      <section className="space-y-3">
        <div className="flex items-center gap-2 border-t border-border/60 pt-5">
          <Layers className="h-4 w-4 shrink-0 text-primary" />
          <h3 className="text-sm font-semibold text-foreground sm:text-base">
            Server-side cohorts &amp; Activation files
          </h3>
        </div>
        <ServerCohortPanel />
      </section>
    </div>
  );
}
