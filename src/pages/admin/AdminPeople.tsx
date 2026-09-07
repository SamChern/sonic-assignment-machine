import { Link } from "react-router-dom";
import { useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ArrowLeft, RefreshCw, Search } from "lucide-react";
import { useAdminPeople } from "@/hooks/useAdminPeople";
import { useCreatorApplications } from "@/hooks/useCreatorApplications";
import PeopleTable from "@/components/admin/PeopleTable";
import CreatorApplicationQueue from "@/components/admin/CreatorApplicationQueue";

/**
 * The admin's own space: who has an account, what they pay for, what they can
 * reach, and the creator applications waiting on a decision — all on one screen.
 */
export default function AdminPeople() {
  const {
    people,
    search,
    setSearch,
    page,
    setPage,
    pageSize,
    loading,
    busy,
    error,
    reload,
    setMembership,
    setRole,
  } = useAdminPeople();
  const {
    applications,
    busy: creatorBusy,
    update: updateApplication,
    reload: reloadApplications,
  } = useCreatorApplications();
  const [query, setQuery] = useState(search);

  const pending = useMemo(
    () => applications.filter((a) => a.status === "new" || a.status === "reviewing"),
    [applications],
  );

  const stats = useMemo(
    () => [
      { label: "Accounts on this page", value: people.length },
      {
        label: "Paid members",
        value: people.filter((p) => p.membership_status === "active").length,
      },
      {
        label: "Waiting on payment",
        value: people.filter((p) => p.membership_status === "awaiting_payment").length,
      },
      { label: "Creator decisions waiting", value: pending.length },
    ],
    [people, pending.length],
  );

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 pb-mobile-nav sm:px-6">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <Button asChild variant="ghost" size="sm" className="mb-2 -ml-2">
            <Link to="/admin">
              <ArrowLeft className="mr-1.5 h-4 w-4" aria-hidden="true" />
              Admin overview
            </Link>
          </Button>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">People &amp; access</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Every account, its plan and its access — plus the creators waiting to be approved.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          disabled={loading}
          onClick={() => {
            void reload();
            void reloadApplications();
          }}
        >
          <RefreshCw className="mr-1.5 h-4 w-4" aria-hidden="true" />
          Refresh
        </Button>
      </div>

      {error && (
        <Card className="mb-6 border-destructive/40 p-4 text-sm text-destructive">{error}</Card>
      )}

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {stats.map((stat) => (
          <Card key={stat.label} className="p-4">
            <p className="text-xs text-muted-foreground">{stat.label}</p>
            <p className="text-2xl font-semibold text-foreground">{stat.value}</p>
          </Card>
        ))}
      </div>

      <Tabs defaultValue="people">
        <TabsList>
          <TabsTrigger value="people">Accounts</TabsTrigger>
          <TabsTrigger value="creators">Creator approvals ({pending.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="people" className="mt-4 space-y-4">
          <form
            className="flex flex-wrap items-center gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              setSearch(query);
            }}
          >
            <div className="relative min-w-[14rem] flex-1">
              <Search
                className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search by email or name"
                aria-label="Search accounts"
                className="pl-9"
              />
            </div>
            <Button type="submit" variant="outline" size="sm">
              Search
            </Button>
          </form>

          {loading ? (
            <Card className="p-6 text-sm text-muted-foreground">Loading accounts…</Card>
          ) : (
            <PeopleTable
              people={people}
              busy={busy}
              onMembership={setMembership}
              onRole={setRole}
            />
          )}

          <div className="flex items-center justify-between">
            <Button
              variant="ghost"
              size="sm"
              disabled={page === 0 || loading}
              onClick={() => setPage(Math.max(0, page - 1))}
            >
              Previous
            </Button>
            <span className="text-xs text-muted-foreground">Page {page + 1}</span>
            <Button
              variant="ghost"
              size="sm"
              disabled={people.length < pageSize || loading}
              onClick={() => setPage(page + 1)}
            >
              Next
            </Button>
          </div>
        </TabsContent>

        <TabsContent value="creators" className="mt-4">
          <CreatorApplicationQueue
            applications={applications}
            busy={creatorBusy}
            onUpdate={updateApplication}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
