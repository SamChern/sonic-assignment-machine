import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ChevronDown, ChevronUp, RefreshCw, ShieldCheck, TriangleAlert } from "lucide-react";
import { forceUpdate, getVersionStatus, type VersionStatus } from "@/pwa/registerServiceWorker";
import { useAuth } from "@/hooks/useAuth";

const short = (value: string | null | undefined) =>
  value ? (value.length > 12 ? `${value.slice(0, 12)}…` : value) : "—";

/**
 * Build-stamp / service-worker status.
 *
 * Everyday visitors see nothing at all unless their tab is running an older
 * release, in which case a single quiet "Update available / Reload" bar appears.
 * Build ids and service-worker internals are admin-only detail.
 */
const VersionStatusPanel = () => {
  const { isAdmin } = useAuth();
  const [status, setStatus] = useState<VersionStatus | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const next = await getVersionStatus();
    setStatus(next);
    if (next.stale) setOpen(true);
  }, []);

  useEffect(() => {
    void refresh();
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    const timer = window.setInterval(() => void refresh(), 5 * 60 * 1000);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.clearInterval(timer);
    };
  }, [refresh]);

  if (!status) return null;

  const stale = status.stale;
  // Nothing to say to a non-admin on a current build.
  if (!stale && !isAdmin) return null;

  return (
    <div className="above-mobile-nav z-banner fixed left-3 flex max-w-[min(22rem,calc(100vw-1.5rem))] flex-col">
      <div className="rounded-xl border border-border/60 bg-card/90 shadow-elegant backdrop-blur-md">
        <button
          type="button"
          onClick={() => {
            if (!isAdmin && stale) {
              setBusy(true);
              void forceUpdate();
              return;
            }
            setOpen((v) => !v);
          }}
          aria-expanded={isAdmin ? open : undefined}
          className="flex w-full items-center gap-2 px-3 py-2 text-left"
        >
          {stale ? (
            <TriangleAlert className="h-4 w-4 shrink-0 text-destructive" aria-hidden />
          ) : (
            <ShieldCheck className="h-4 w-4 shrink-0 text-primary" aria-hidden />
          )}
          <span className="min-w-0 flex-1 truncate text-xs font-medium">
            {stale
              ? isAdmin
                ? "Update available"
                : "A newer version is ready — tap to reload"
              : "Version up to date"}
          </span>
          {isAdmin && (
            <>
              <Badge variant="outline" className="shrink-0 font-mono text-[10px]">
                {short(status.compiledBuildId)}
              </Badge>
              {open ? (
                <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
              ) : (
                <ChevronUp className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
              )}
            </>
          )}
        </button>

        {open && isAdmin && (
          <div className="space-y-2 border-t border-border/60 px-3 py-2 text-[11px] text-muted-foreground">
            <dl className="space-y-1">
              <div className="flex items-center justify-between gap-2">
                <dt>Running build</dt>
                <dd className="font-mono text-foreground">{short(status.compiledBuildId)}</dd>
              </div>
              <div className="flex items-center justify-between gap-2">
                <dt>Deployed build</dt>
                <dd className="font-mono text-foreground">{short(status.deployedBuildId)}</dd>
              </div>
              <div className="flex items-center justify-between gap-2">
                <dt>Service worker</dt>
                <dd className="font-mono text-foreground">
                  {status.swState}
                  {status.swVersion ? ` · ${status.swVersion}` : ""}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-2">
                <dt>Page controlled</dt>
                <dd className="font-mono text-foreground">{status.controlled ? "yes" : "no"}</dd>
              </div>
            </dl>

            {stale && (
              <p className="text-foreground">
                This shell is running an older release. Reload to load the latest version.
              </p>
            )}

            <div className="flex flex-wrap gap-2 pt-1">
              <Button
                size="sm"
                className="h-8 flex-1 text-xs"
                disabled={busy}
                onClick={() => {
                  setBusy(true);
                  void forceUpdate();
                }}
              >
                <RefreshCw className={`mr-1 h-3.5 w-3.5 ${busy ? "animate-spin" : ""}`} />
                {busy ? "Updating" : stale ? "Reload now" : "Force update"}
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-8 text-xs"
                disabled={busy}
                onClick={() => void refresh()}
              >
                Check again
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default VersionStatusPanel;
