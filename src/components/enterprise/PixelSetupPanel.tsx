import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/hooks/use-toast";
import { Copy, Loader2, Plus, RefreshCw, Tag } from "lucide-react";

const PIXEL_ENDPOINT = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/pixel-collect`;

interface TagRow {
  id: string;
  tag_id: string;
  name: string;
  allowed_origins: string[];
  active: boolean;
  created_at: string;
}

interface EventRow {
  id: string;
  event_name: string;
  kpi_metric: string | null;
  kpi_value: number | null;
  external_user_id: string | null;
  occurred_at: string;
}

const PixelSetupPanel = ({
  organizationId,
  canWrite,
}: {
  organizationId: string;
  canWrite: boolean;
}) => {
  const [tags, setTags] = useState<TagRow[]>([]);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState("");
  const [newOrigins, setNewOrigins] = useState("");
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: t }, { data: e }] = await Promise.all([
      supabase
        .from("pixel_tags")
        .select("id, tag_id, name, allowed_origins, active, created_at")
        .eq("organization_id", organizationId)
        .order("created_at", { ascending: false }),
      supabase
        .from("pixel_events")
        .select("id, event_name, kpi_metric, kpi_value, external_user_id, occurred_at")
        .eq("organization_id", organizationId)
        .order("occurred_at", { ascending: false })
        .limit(25),
    ]);
    setTags((t ?? []) as TagRow[]);
    setEvents((e ?? []) as EventRow[]);
    setLoading(false);
  }, [organizationId]);

  useEffect(() => {
    void load();
  }, [load]);

  const createTag = useCallback(async () => {
    if (!newName.trim()) {
      toast({ title: "Name the tag first", variant: "destructive" });
      return;
    }
    setCreating(true);
    const tagId = `SS-${crypto.randomUUID().replace(/-/g, "").slice(0, 10).toUpperCase()}`;
    const origins = newOrigins
      .split(",")
      .map((o) => o.trim())
      .filter(Boolean);
    const { error } = await supabase.from("pixel_tags").insert({
      organization_id: organizationId,
      tag_id: tagId,
      name: newName.trim(),
      allowed_origins: origins,
    });
    setCreating(false);
    if (error) {
      toast({ title: "Could not create tag", description: error.message, variant: "destructive" });
      return;
    }
    setNewName("");
    setNewOrigins("");
    toast({ title: "Tag created", description: tagId });
    void load();
  }, [newName, newOrigins, organizationId, load]);

  const copy = (text: string) => {
    void navigator.clipboard.writeText(text);
    toast({ title: "Copied to clipboard" });
  };

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="flex flex-wrap items-center gap-2">
          <Tag className="h-4 w-4 text-primary" />
          <h2 className="text-sm font-semibold">Site tracking tags</h2>
          <Button variant="ghost" size="sm" className="ml-auto" onClick={() => void load()}>
            <RefreshCw className="mr-1 h-4 w-4" />
            Refresh
          </Button>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          Install the tag on every page to establish a baseline, then fire one event per conversion
          or KPI moment — the same pattern Google, Meta and TikTok tags use. You can also fire the
          event through a tag manager container instead of editing the page directly.
        </p>

        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          <Input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Tag name (e.g. Main site)"
          />
          <Input
            value={newOrigins}
            onChange={(e) => setNewOrigins(e.target.value)}
            placeholder="Allowed domains, comma separated"
            className="sm:col-span-2"
          />
        </div>
        <Button size="sm" className="mt-2" onClick={createTag} disabled={creating || !canWrite}>
          {creating ? (
            <Loader2 className="mr-1 h-4 w-4 animate-spin" />
          ) : (
            <Plus className="mr-1 h-4 w-4" />
          )}
          Create tag
        </Button>
      </Card>

      {loading ? (
        <Skeleton className="h-32 w-full" />
      ) : (
        tags.map((t) => {
          const snippet = `<script src="${window.location.origin}/ss-pixel.js" data-tag="${t.tag_id}"></script>
<script>
  // fire when the KPI moment happens
  ssq('event', 'video_complete', {
    kpi_metric: 'vcr',
    kpi_value: 1,
    external_user_id: 'YOUR_USER_ID'
  });
</script>`;
          return (
            <Card key={t.id} className="p-4">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-medium">{t.name}</p>
                <Badge variant="outline" className="font-mono text-[11px]">{t.tag_id}</Badge>
                <Badge variant={t.active ? "default" : "outline"} className="text-[11px]">
                  {t.active ? "active" : "paused"}
                </Badge>
                <Button variant="ghost" size="sm" className="ml-auto" onClick={() => copy(snippet)}>
                  <Copy className="mr-1 h-4 w-4" />
                  Copy snippet
                </Button>
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground">
                {t.allowed_origins.length
                  ? `Allowed domains: ${t.allowed_origins.join(", ")}`
                  : "Any domain accepted — add domains to lock this tag down."}
              </p>
              <pre className="mt-2 overflow-x-auto rounded-lg border border-border/60 bg-muted/30 p-3 text-[11px]">
                {snippet}
              </pre>
              <p className="mt-2 text-[11px] text-muted-foreground">
                Server-to-server posts go to{" "}
                <span className="font-mono break-all">{PIXEL_ENDPOINT}</span> with the same fields.
              </p>
            </Card>
          );
        })
      )}

      <Card className="p-4">
        <h3 className="text-sm font-semibold">Latest captured events</h3>
        {!events.length ? (
          <p className="mt-2 text-xs text-muted-foreground">
            No events yet. Install a tag and load a page to confirm capture.
          </p>
        ) : (
          <div className="mt-3 space-y-1">
            {events.map((e) => (
              <div
                key={e.id}
                className="flex flex-wrap items-center gap-2 rounded-lg border border-border/50 bg-muted/10 p-2 text-[11px]"
              >
                <span className="font-medium">{e.event_name}</span>
                {e.kpi_metric && (
                  <span className="text-primary">
                    {e.kpi_metric} = {e.kpi_value ?? "—"}
                  </span>
                )}
                {e.external_user_id && (
                  <span className="text-muted-foreground">{e.external_user_id}</span>
                )}
                <span className="ml-auto text-muted-foreground">
                  {new Date(e.occurred_at).toLocaleString()}
                </span>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
};

export default PixelSetupPanel;
