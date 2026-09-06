import { Link, useNavigate } from "react-router-dom";
import { useEffect } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useDemoRequests } from "@/hooks/useDemoRequests";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowLeft, CalendarClock, Loader2, RefreshCw } from "lucide-react";
import DemoRequestForm from "@/components/admin/DemoRequestForm";
import DemoRequestQueue, { statusTone } from "@/components/admin/DemoRequestQueue";

const STATUS_COPY: Record<string, string> = {
  new: "Received — we're reviewing it.",
  contacted: "We've replied by email.",
  scheduled: "A demo time is booked.",
  completed: "Demo done.",
  declined: "Closed without a demo.",
};

/**
 * Enterprise demo booking. Any signed-in account can send a request and follow
 * its progress; admins additionally see and manage every request.
 */
export default function AdminDemoRequests() {
  const { user, isAdmin, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const { requests, mine, loading, busy, error, reload, create, update } = useDemoRequests();

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
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Enterprise demos</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Ask for a walkthrough of audiences, prediction and activation — and see where your
            request stands.
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
        <DemoRequestForm busy={busy} defaultEmail={user.email ?? ""} onSubmit={create} />

        <section>
          <h2 className="mb-3 text-lg font-semibold text-foreground">Your requests</h2>
          {loading ? (
            <Card className="p-6 text-sm text-muted-foreground">Loading…</Card>
          ) : mine.length === 0 ? (
            <Card className="p-6 text-sm text-muted-foreground">
              You haven&apos;t asked for a demo yet.
            </Card>
          ) : (
            <div className="space-y-3">
              {mine.map((request) => (
                <Card key={request.id} className="p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h3 className="text-base font-semibold text-foreground">
                        {request.company_name}
                      </h3>
                      <p className="text-sm text-muted-foreground">
                        Sent {new Date(request.created_at).toLocaleDateString()} ·{" "}
                        {STATUS_COPY[request.status] ?? request.status}
                      </p>
                    </div>
                    <Badge variant="outline" className={statusTone(request.status)}>
                      {request.status}
                    </Badge>
                  </div>
                  {request.scheduled_at && (
                    <p className="mt-3 flex items-center gap-1.5 text-sm text-primary">
                      <CalendarClock className="h-4 w-4" aria-hidden="true" />
                      {new Date(request.scheduled_at).toLocaleString()}
                    </p>
                  )}
                  <p className="mt-3 whitespace-pre-wrap text-sm text-muted-foreground">
                    {request.use_case}
                  </p>
                </Card>
              ))}
            </div>
          )}
        </section>

        {isAdmin && (
          <section>
            <h2 className="mb-3 text-lg font-semibold text-foreground">
              All requests ({requests.length})
            </h2>
            <DemoRequestQueue requests={requests} busy={busy} onUpdate={update} />
          </section>
        )}
      </div>
    </div>
  );
}
