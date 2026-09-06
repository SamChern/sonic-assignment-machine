// Connector directory for the "Needs setup" view: one row per registered
// provider, each linking to its dedicated configuration page.
import { Link } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { Integration } from "@/config/integrations";
import type { StatusEntry, TestEntry } from "@/components/admin/IntegrationCard";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  Loader2,
  Network,
  Plug,
  XCircle,
} from "lucide-react";

const badgeFor = (
  integration: Integration,
  status: StatusEntry | undefined,
  lastTest: TestEntry | undefined,
  statusLoading: boolean,
) => {
  if (statusLoading) {
    return (
      <Badge variant="outline" className="gap-1">
        <Loader2 className="h-3 w-3 animate-spin" /> Checking…
      </Badge>
    );
  }
  if (lastTest && !lastTest.success) {
    return (
      <Badge variant="destructive" className="gap-1">
        <XCircle className="h-3 w-3" /> Test failed
      </Badge>
    );
  }
  if (lastTest?.success) {
    return (
      <Badge className="gap-1 bg-green-600 hover:bg-green-600">
        <CheckCircle2 className="h-3 w-3" /> Verified
      </Badge>
    );
  }
  const requiredKeys = integration.fields.filter((f) => f.required).map((f) => f.key);
  const configured =
    integration.fields.length === 0
      ? true
      : requiredKeys.every((k) => status?.fields.includes(k));
  return configured ? (
    <Badge variant="secondary" className="gap-1">
      <CheckCircle2 className="h-3 w-3" /> Configured
    </Badge>
  ) : (
    <Badge variant="outline" className="gap-1 border-amber-600/50 text-amber-600">
      <AlertTriangle className="h-3 w-3" /> Not configured
    </Badge>
  );
};

export const IntegrationSetupList = ({
  integrations,
  status,
  lastTest,
  statusLoading,
}: {
  integrations: Integration[];
  status: Record<string, StatusEntry>;
  lastTest: Record<string, TestEntry>;
  statusLoading: boolean;
}) => (
  <div className="space-y-3">
    {integrations.map((integration) => (
      <Card key={integration.id} className="p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              {integration.kind === "mcp" ? (
                <Network className="h-4 w-4 text-primary" />
              ) : (
                <Plug className="h-4 w-4 text-primary" />
              )}
              <h3 className="font-semibold">{integration.name}</h3>
              {badgeFor(integration, status[integration.id], lastTest[integration.id], statusLoading)}
            </div>
            <p className="text-sm text-muted-foreground">{integration.description}</p>
            {status[integration.id]?.updated_at && (
              <p className="text-xs text-muted-foreground">
                Last updated{" "}
                {new Date(status[integration.id].updated_at as string).toLocaleString()}
              </p>
            )}
          </div>
          <Button size="sm" variant="outline" asChild>
            <Link to={`/admin/integrations/${integration.id}`}>
              Configure <ChevronRight className="ml-1 h-4 w-4" />
            </Link>
          </Button>
        </div>
      </Card>
    ))}
  </div>
);

export default IntegrationSetupList;
