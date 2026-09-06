import { Link, useNavigate } from "react-router-dom";
import { useEffect } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useCreatorApplications } from "@/hooks/useCreatorApplications";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Loader2, RefreshCw } from "lucide-react";
import CreatorApplicationForm from "@/components/admin/CreatorApplicationForm";
import CreatorApplicationQueue, {
  creatorStatusTone,
} from "@/components/admin/CreatorApplicationQueue";
import CreatorWorkspaceCard from "@/components/admin/CreatorWorkspaceCard";

const STATUS_COPY: Record<string, string> = {
  new: "Received — we're reviewing it.",
  reviewing: "Being reviewed now.",
  approved: "Approved — your Creator space is open.",
  waitlisted: "On the waiting list.",
  declined: "Closed for now.",
};

/**
 * Creator applications. Any signed-in account can apply and follow the outcome;
 * admins additionally see and decide on every application.
 */
export default function AdminCreatorApplications() {
  const { user, isAdmin, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const { applications, mine, approved, loading, busy, error, reload, create, update } =
    useCreatorApplications();

  useEffect(() => {
    if (!authLoading && !user) navigate("/auth", { replace: true });
  }, [authLoading, user, navigate]);

  if (authLoading || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-primary" aria-hidden="true" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <Button asChild variant="ghost" size="sm" className="mb-2 -ml-2">
            <Link to={isAdmin ? "/admin" : "/workspace"}>
              <ArrowLeft className="mr-1.5 h-4 w-4" aria-hidden="true" />
              Back
            </Link>
          </Button>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            Creator applications
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Apply to work with your own catalogue — originality, lineage and licence terms — and
            see where your application stands.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void reload()} disabled={loading}>
          <RefreshCw className="mr-1.5 h-4 w-4" aria-hidden="true" />
          Refresh
        </Button>
      </div>

      {error && (
        <Card className="mb-6 border-destructive/40 p-4 text-sm text-destructive">{error}</Card>
      )}

      <div className="space-y-6">
        {approved && <CreatorWorkspaceCard />}

        <CreatorApplicationForm busy={busy} defaultEmail={user.email ?? ""} onSubmit={create} />

        <section>
          <h2 className="mb-3 text-lg font-semibold text-foreground">Your applications</h2>
          {loading ? (
            <Card className="p-6 text-sm text-muted-foreground">Loading…</Card>
          ) : mine.length === 0 ? (
            <Card className="p-6 text-sm text-muted-foreground">
              You haven&apos;t applied yet.
            </Card>
          ) : (
            <div className="space-y-3">
              {mine.map((application) => (
                <Card key={application.id} className="p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h3 className="text-base font-semibold text-foreground">
                        {application.org_name ?? application.contact_name}
                      </h3>
                      <p className="text-sm text-muted-foreground">
                        Sent {new Date(application.created_at).toLocaleDateString()} ·{" "}
                        {STATUS_COPY[application.status] ?? application.status}
                      </p>
                    </div>
                    <Badge variant="outline" className={creatorStatusTone(application.status)}>
                      {application.status}
                    </Badge>
                  </div>
                  {application.use_case && (
                    <p className="mt-3 whitespace-pre-wrap text-sm text-muted-foreground">
                      {application.use_case}
                    </p>
                  )}
                </Card>
              ))}
            </div>
          )}
        </section>

        {isAdmin && (
          <section>
            <h2 className="mb-3 text-lg font-semibold text-foreground">
              All applications ({applications.length})
            </h2>
            <CreatorApplicationQueue
              applications={applications}
              busy={busy}
              onUpdate={update}
            />
          </section>
        )}
      </div>
    </div>
  );
}
