import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { friendlyError } from "@/lib/friendlyError";

interface DigestRow {
  id: string;
  week_start: string;
  headline: string | null;
  bullets: unknown;
  published: boolean;
  created_at: string;
}

const mondayOf = (d = new Date()) => {
  const copy = new Date(d);
  const day = (copy.getUTCDay() + 6) % 7;
  copy.setUTCDate(copy.getUTCDate() - day);
  return copy.toISOString().slice(0, 10);
};

/**
 * The loop, made visible (item 9): the same weekly digest admins read, written
 * in plain language and publishable as "what SONICSIM learned this week".
 */
export function LearningLoopPanel() {
  const [rows, setRows] = useState<DigestRow[]>([]);
  const [week, setWeek] = useState(mondayOf());
  const [headline, setHeadline] = useState("");
  const [bullets, setBullets] = useState("");

  const load = async () => {
    const { data, error } = await supabase
      .from("learning_digests")
      .select("id, week_start, headline, bullets, published, created_at")
      .order("week_start", { ascending: false })
      .limit(25);
    if (error) {
      toast({ title: "Couldn't load notes", description: friendlyError(error), variant: "destructive" });
      return;
    }
    setRows(data ?? []);
  };

  useEffect(() => {
    void load();
  }, []);

  /** Pre-fills the note from what actually happened in the last seven days. */
  const draftFromData = async () => {
    const since = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
    const [scored, grounded, tags] = await Promise.all([
      supabase
        .from("source_analyses")
        .select("id", { count: "estimated", head: true })
        .gte("created_at", since),
      supabase
        .from("source_analyses")
        .select("id", { count: "estimated", head: true })
        .gte("created_at", since)
        .eq("grounding_level", "grounded"),
      supabase
        .from("semantic_normalization")
        .select("id", { count: "estimated", head: true })
        .gte("updated_at", since),
    ]);
    setHeadline(`We listened to ${scored.count ?? 0} new sounds this week`);
    setBullets(
      [
        `${scored.count ?? 0} sounds scored across the six categories.`,
        `${grounded.count ?? 0} of them were matched to real audio we have heard before, not just their descriptions.`,
        `${tags.count ?? 0} tag patterns were re-calibrated, so future scores land closer first time.`,
      ].join("\n"),
    );
  };

  const save = async (publish: boolean) => {
    const list = bullets.split("\n").map((b) => b.trim()).filter(Boolean);
    if (!headline.trim() || list.length === 0) {
      toast({ title: "Add a headline and at least one line", variant: "destructive" });
      return;
    }
    const { error } = await supabase
      .from("learning_digests")
      .upsert(
        { week_start: week, headline: headline.trim(), bullets: list, published: publish },
        { onConflict: "week_start" },
      );
    if (error) {
      toast({ title: "Couldn't save", description: friendlyError(error), variant: "destructive" });
      return;
    }
    toast({ title: publish ? "Note published" : "Note saved as a draft" });
    await load();
  };

  const togglePublished = async (row: DigestRow) => {
    const { error } = await supabase
      .from("learning_digests")
      .update({ published: !row.published })
      .eq("id", row.id);
    if (error) {
      toast({ title: "Couldn't update", description: friendlyError(error), variant: "destructive" });
      return;
    }
    await load();
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>What SonicSIM learned this week</CardTitle>
        <CardDescription>
          The weekly note, in plain language. Drafts stay private; published notes appear on the
          public method page once the public switch above is on.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-[auto_1fr]">
          <div className="space-y-2">
            <Label htmlFor="digest-week">Week beginning</Label>
            <Input id="digest-week" type="date" value={week} onChange={(e) => setWeek(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="digest-headline">Headline</Label>
            <Input id="digest-headline" value={headline} onChange={(e) => setHeadline(e.target.value)} />
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="digest-bullets">Lines (one per row)</Label>
          <Textarea id="digest-bullets" rows={4} value={bullets} onChange={(e) => setBullets(e.target.value)} />
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={draftFromData}>
            Draft from this week's data
          </Button>
          <Button size="sm" variant="secondary" onClick={() => save(false)}>
            Save draft
          </Button>
          <Button size="sm" onClick={() => save(true)}>
            Publish
          </Button>
        </div>

        <div className="space-y-2">
          {rows.map((row) => (
            <div key={row.id} className="rounded-md border p-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium">
                  {row.week_start} — {row.headline}
                </span>
                <div className="flex items-center gap-2">
                  <Badge variant={row.published ? "secondary" : "outline"}>
                    {row.published ? "published" : "draft"}
                  </Badge>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => togglePublished(row)}
                    aria-label={`${row.published ? "Unpublish" : "Publish"} the note for ${row.week_start}`}
                  >
                    {row.published ? "Unpublish" : "Publish"}
                  </Button>
                </div>
              </div>
              <ul className="mt-1 list-disc pl-5 text-xs text-muted-foreground">
                {(Array.isArray(row.bullets) ? (row.bullets as string[]) : []).map((b, i) => (
                  <li key={i}>{b}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
