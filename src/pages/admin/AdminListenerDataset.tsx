import { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useListenerDataset } from "@/hooks/useListenerDataset";
import ListenerDatasetDashboard from "@/components/admin/ListenerDatasetDashboard";

const WINDOWS = [7, 30, 90, 180];

/** Admin view of the real listener population: distributions, trend, breakdowns. */
export default function AdminListenerDataset() {
  const [days, setDays] = useState(30);
  const { data, loading, error, reload } = useListenerDataset(days);

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
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Listener population</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Every listener profile behind audience matching — how their six category scores are
            spread, how activity has moved, and what the evidence looks like.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-lg border border-border/60 p-0.5">
            {WINDOWS.map((w) => (
              <button
                key={w}
                onClick={() => setDays(w)}
                aria-pressed={days === w}
                className={`rounded-md px-2.5 py-1 text-xs font-medium transition-smooth ${
                  days === w ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {w}d
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

      <ListenerDatasetDashboard data={data} loading={loading} />

      {data && (
        <p className="mt-6 text-[11px] text-muted-foreground">
          Built {new Date(data.computed_at).toLocaleString()}
        </p>
      )}
    </div>
  );
}
