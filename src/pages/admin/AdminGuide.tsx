import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, BookOpen, Plus, RefreshCw, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { useAdminGuide, type GuideEntry, type GuideKind } from "@/hooks/useAdminGuide";
import { GlossaryItem, GuideEditor, RunbookItem } from "@/components/admin/GuidePanels";

/**
 * /admin/guide — the in-app Guide & Glossary.
 *
 * Two views over one database-backed source of truth: a searchable glossary of
 * the concepts the pipeline runs on, and a runbook card per subsystem with its
 * setup notes, verify line, honest status and a link to the live surface.
 */
const AdminGuide = () => {
  const navigate = useNavigate();
  const { isAdmin, loading: authLoading } = useAuth();
  const { entries, loading, error, reload, save, setArchived, lastUpdated } = useAdminGuide();
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<GuideKind>("glossary");
  const [editing, setEditing] = useState<GuideEntry | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!authLoading && !isAdmin) navigate("/", { replace: true });
  }, [authLoading, isAdmin, navigate]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return entries.filter((e) => {
      if (e.kind !== tab) return false;
      if (e.archived) return false;
      if (!q) return true;
      return (
        e.title.toLowerCase().includes(q) ||
        e.category.toLowerCase().includes(q) ||
        e.body.toLowerCase().includes(q)
      );
    });
  }, [entries, tab, query]);

  const counts = useMemo(() => {
    const live = entries.filter((e) => e.kind === "runbook" && e.status === "live").length;
    const open = entries.filter((e) => e.kind === "runbook" && e.status !== "live").length;
    return { live, open };
  }, [entries]);

  const handleSave = async (...args: Parameters<typeof save>) => {
    try {
      await save(...args);
      toast({ title: "Guide updated" });
    } catch (err) {
      toast({
        title: "Could not save entry",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    }
  };

  const handleArchive = async (entry: GuideEntry) => {
    try {
      await setArchived(entry.id, !entry.archived);
    } catch (err) {
      toast({
        title: "Could not archive entry",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-20 border-b border-border/60 bg-background/80 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div className="flex min-w-0 items-center gap-2">
            <BookOpen className="h-5 w-5 shrink-0 text-primary" />
            <div className="min-w-0">
              <h1 className="truncate text-lg font-semibold">Guide &amp; Glossary</h1>
              <p className="truncate text-xs text-muted-foreground">
                {counts.live} subsystems live · {counts.open} still open
                {lastUpdated
                  ? ` · updated ${new Date(lastUpdated).toLocaleDateString()}`
                  : ""}
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button variant="ghost" size="icon" aria-label="Reload" onClick={() => void reload()}>
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            </Button>
            <Button variant="ghost" size="sm" onClick={() => navigate("/admin")}>
              <ArrowLeft className="mr-1 h-4 w-4" />
              Admin
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-6 pb-mobile-nav sm:px-6">
        {error && (
          <Card className="mb-4 border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
            {error}
          </Card>
        )}

        <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search terms, categories, steps…"
              className="pl-9"
              aria-label="Search the guide"
            />
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setEditing(null);
              setCreating(true);
            }}
          >
            <Plus className="mr-1 h-4 w-4" />
            New entry
          </Button>
        </div>

        {(creating || editing) && (
          <div className="mb-4">
            <GuideEditor
              entry={editing}
              kind={tab}
              onCancel={() => {
                setCreating(false);
                setEditing(null);
              }}
              onSave={handleSave}
            />
          </div>
        )}

        <Tabs value={tab} onValueChange={(v) => setTab(v as GuideKind)}>
          <TabsList className="mb-4">
            <TabsTrigger value="glossary">Glossary</TabsTrigger>
            <TabsTrigger value="runbook">Setup runbook</TabsTrigger>
          </TabsList>

          <TabsContent value="glossary" className="grid gap-3 sm:grid-cols-2">
            {filtered.map((e) => (
              <GlossaryItem key={e.id} entry={e} onEdit={setEditing} />
            ))}
          </TabsContent>

          <TabsContent value="runbook" className="grid gap-3">
            {filtered.map((e) => (
              <RunbookItem
                key={e.id}
                entry={e}
                onEdit={setEditing}
                onArchive={(entry) => void handleArchive(entry)}
              />
            ))}
          </TabsContent>
        </Tabs>

        {!loading && filtered.length === 0 && (
          <p className="py-10 text-center text-sm text-muted-foreground">
            Nothing matches “{query}”.
          </p>
        )}
      </main>
    </div>
  );
};

export default AdminGuide;
