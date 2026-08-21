import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { RefreshCw, X, Sparkles } from "lucide-react";
import { SW_UPDATE_EVENT, applyServiceWorkerUpdate } from "@/pwa/registerServiceWorker";

/**
 * Shows an in-app banner when a newer build has been downloaded by the service
 * worker, letting the user reload into the new version on their own terms.
 */
const PwaUpdateBanner = () => {
  const [available, setAvailable] = useState(false);
  const [updating, setUpdating] = useState(false);

  useEffect(() => {
    const onUpdate = () => setAvailable(true);
    window.addEventListener(SW_UPDATE_EVENT, onUpdate);
    return () => window.removeEventListener(SW_UPDATE_EVENT, onUpdate);
  }, []);

  if (!available) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-x-0 bottom-4 z-50 flex justify-center px-4"
    >
      <div className="flex w-full max-w-md items-center gap-3 rounded-xl border border-border/60 bg-card/90 p-3 shadow-elegant backdrop-blur-md">
        <span
          aria-hidden
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
          style={{ background: "var(--gradient-teal)" }}
        >
          <Sparkles className="h-4 w-4 text-primary-foreground" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">A new version is available</p>
          <p className="text-xs text-muted-foreground">Reload to get the latest updates.</p>
        </div>
        <Button
          size="sm"
          onClick={() => {
            setUpdating(true);
            applyServiceWorkerUpdate();
          }}
          disabled={updating}
        >
          <RefreshCw className={`mr-1 h-4 w-4 ${updating ? "animate-spin" : ""}`} />
          {updating ? "Updating" : "Reload"}
        </Button>
        <Button
          size="icon"
          variant="ghost"
          aria-label="Dismiss update notification"
          onClick={() => setAvailable(false)}
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
};

export default PwaUpdateBanner;
