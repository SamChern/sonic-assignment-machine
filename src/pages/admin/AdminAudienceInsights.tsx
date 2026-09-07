import { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useAudienceInsights } from "@/hooks/useAudienceInsights";
import AudienceInsightsPanels from "@/components/admin/AudienceInsightsPanels";

const SAMPLES = [10000, 40000, 100000];

/** Admin audience insights: the tag, demographic and score make-up of the population. */
export default function AdminAudienceInsights() {
  const [sample, setSample] = useState(40000);
  const { data, loading, error, reload } = useAudienceInsights(sample);

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 pb-mobile-nav sm:px-6">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <Button asChild variant="ghost" size="sm" className="mb-2 -ml-2">
            <Link to="/admin">
              <ArrowLeft className="mr-1.5 h-4 w-4" aria-hidden="true" />
              Back
            </Link>
          </Button>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Audience insights</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            What the real listener population is made of — age groups, what they watch, interest
            categories, and the category scores that go with each.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-lg border border-border/60 p-0.5">
            {SAMPLES.map((s) => (
              <button
                key={s}
                onClick={() => setSample(s)}
                aria-pressed={sample === s}
                className={`rounded-md px-2.5 py-1 text-xs font-medium transition-smooth ${
                  sample === s ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {(s / 1000).toFixed(0)}k
              </button>
            ))}
          </div>
          <Button variant="outline" size="sm" onClick={() => void reload()} disabled={loading}>
            <RefreshCw className="mr-1.5 h-4 w-4" aria-hidden="true" />
            Refresh
          </Button>
        </div>
      </div>

      {error && (
        <Card className="mb-6 border-destructive/40 p-4 text-sm text-destructive">{error}</Card>
      )}

      <AudienceInsightsPanels data={data} loading={loading} />

      {data && (
        <p className="mt-6 text-[11px] text-muted-foreground">
          Built {new Date(data.computed_at).toLocaleString()} from a sample of up to{" "}
          {data.sample_size.toLocaleString()} profiles.
        </p>
      )}
    </div>
  );
}
