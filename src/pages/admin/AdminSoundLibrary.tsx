import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Library, RefreshCw, Sparkles, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/hooks/useAuth";
import { useSoundLibrary, type GapRow } from "@/hooks/useSoundLibrary";
import {
  AddClipForm,
  CoverageMeter,
  GapList,
  PackList,
  QueuePanel,
} from "@/components/admin/SoundLibraryPanels";

/**
 * Step 14 — The Sound Library.
 *
 * Grounding as a product surface: how much of the signal we actually hear,
 * which tags are still label-only, and which versioned pack the model listens
 * with right now.
 */
const AdminSoundLibrary = () => {
  const navigate = useNavigate();
  const { isAdmin, loading: authLoading } = useAuth();
  const {
    status,
    gaps,
    queue,
    loading,
    busy,
    error,
    reload,
    addToQueue,
    autocurate,
    approve,
    reject,
    publishPack,
    activatePack,
  } = useSoundLibrary();
  const [branch, setBranch] = useState<string | null>(null);
  const [adding, setAdding] = useState<GapRow | null>(null);

  useEffect(() => {
    if (!authLoading && !isAdmin) navigate("/", { replace: true });
  }, [authLoading, isAdmin, navigate]);

  const branches = status?.coverage.map((c) => c.branch) ?? [];
  const pending = (status?.queue_counts.pending ?? 0) + (status?.queue_counts.proposed ?? 0);

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-20 border-b border-border/60 bg-background/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div className="flex min-w-0 items-center gap-2">
            <Library className="h-5 w-5 shrink-0 text-primary" />
            <h1 className="truncate text-lg font-semibold">Sound Library</h1>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => void reload(branch)}>
              <RefreshCw className="mr-1 h-4 w-4" /> Refresh
            </Button>
            <Button variant="ghost" size="sm" onClick={() => navigate("/admin")}>
              <ArrowLeft className="mr-1 h-4 w-4" /> Admin
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-6 px-4 py-6 pb-mobile-nav sm:px-6">
        {error && (
          <Card className="border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
            {error}
          </Card>
        )}

        <Card className="p-5">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="text-sm text-muted-foreground">Signal-weighted grounding coverage</p>
              <p className="text-4xl font-bold tabular-nums text-primary">
                {loading ? "—" : `${status?.coverage_pct ?? 0}%`}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Share of observed tag weight that has real sound behind it, not just a label.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary">{pending} awaiting review</Badge>
              <Button
                size="sm"
                variant="outline"
                disabled={busy === "autocurate"}
                onClick={() => void autocurate(branch).catch(() => undefined)}
              >
                <Sparkles className="mr-1 h-4 w-4" />
                {busy === "autocurate" ? "Curating…" : "Auto-curate gaps"}
              </Button>
              <Button
                size="sm"
                disabled={busy === "publish"}
                onClick={() => void publishPack().catch(() => undefined)}
              >
                <Upload className="mr-1 h-4 w-4" />
                {busy === "publish" ? "Publishing…" : "Publish pack"}
              </Button>
            </div>
          </div>
        </Card>

        <div className="grid gap-6 lg:grid-cols-2">
          <Card className="space-y-4 p-5">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Coverage by branch
            </h2>
            <CoverageMeter rows={status?.coverage ?? []} />
          </Card>

          <Card className="space-y-4 p-5">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Grounding packs
            </h2>
            <PackList packs={status?.packs ?? []} busy={busy} onActivate={(id) => void activatePack(id)} />
          </Card>
        </div>

        <Card className="space-y-4 p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Biggest gaps
            </h2>
            <div className="flex flex-wrap gap-1">
              <Button
                size="sm"
                variant={branch === null ? "secondary" : "ghost"}
                onClick={() => {
                  setBranch(null);
                  void reload(null);
                }}
              >
                All
              </Button>
              {branches.map((b) => (
                <Button
                  key={b}
                  size="sm"
                  variant={branch === b ? "secondary" : "ghost"}
                  onClick={() => {
                    setBranch(b);
                    void reload(b);
                  }}
                >
                  {b}
                </Button>
              ))}
            </div>
          </div>

          {adding && (
            <AddClipForm
              code={adding.code}
              onCancel={() => setAdding(null)}
              onSubmit={addToQueue}
            />
          )}

          <GapList gaps={gaps} onCurate={(g) => setAdding(g)} />
        </Card>

        <Card className="space-y-4 p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Review queue
          </h2>
          <QueuePanel
            rows={queue}
            busy={busy}
            onApprove={(id) => void approve(id).catch(() => undefined)}
            onReject={(id) => void reject(id).catch(() => undefined)}
          />
        </Card>
      </main>
    </div>
  );
};

export default AdminSoundLibrary;
