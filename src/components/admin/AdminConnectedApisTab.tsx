import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { RefreshCw, Settings2 } from "lucide-react";
import {
  ConnectedIntegrationsPanel,
  type StatusEntry,
  type TestEntry,
} from "@/components/admin/ConnectedIntegrationsPanel";

/**
 * Self-contained "APIs & MCPs" tab for the admin dashboard. Loads credential
 * status itself so the connected-integrations console can live inline next to
 * the shared enterprise-style dashboard tabs.
 */
export const AdminConnectedApisTab = () => {
  const navigate = useNavigate();
  const [status, setStatus] = useState<Record<string, StatusEntry>>({});
  const [lastTest, setLastTest] = useState<Record<string, TestEntry>>({});
  const [statusLoading, setStatusLoading] = useState(true);

  const refresh = useCallback(async () => {
    setStatusLoading(true);
    const { data, error } = await supabase.functions.invoke("admin-get-credential-status");
    if (!error && data) {
      setStatus((data.status ?? {}) as Record<string, StatusEntry>);
      setLastTest((data.lastTest ?? {}) as Record<string, TestEntry>);
    }
    setStatusLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" onClick={() => void refresh()} disabled={statusLoading}>
          <RefreshCw className={`mr-1 h-4 w-4 ${statusLoading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
        <Button size="sm" variant="outline" onClick={() => navigate("/admin/integrations")}>
          <Settings2 className="mr-1 h-4 w-4" />
          Full setup page
        </Button>
      </div>
      <ConnectedIntegrationsPanel
        status={status}
        lastTest={lastTest}
        statusLoading={statusLoading}
        onRefresh={() => void refresh()}
        onOpenSetup={() => navigate("/admin/integrations?view=setup")}
      />
    </div>
  );
};

export default AdminConnectedApisTab;
