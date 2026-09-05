import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { friendlyError } from "@/lib/friendlyError";
import { onDeviceFingerprint } from "@/lib/nextlevel/onDeviceFingerprint";
import { RESONANCE_AXES } from "@/lib/nextlevel/resonance";

interface VenueRow {
  id: string;
  name: string;
  place_id: string | null;
  poi_codes: string[] | null;
  context_vector: unknown;
  status: string;
  created_at: string;
}

/**
 * Live context (item 8): score the sonic character of a place from the field
 * recordings already licensed in the Sound Library, then attach the cohorts
 * present there. One pilot-ready venue path, admin only.
 */
export function LiveContextPanel() {
  const [rows, setRows] = useState<VenueRow[]>([]);
  const [name, setName] = useState("");
  const [codes, setCodes] = useState("poi.venue.cafe, poi.ambience.crowd");

  const load = async () => {
    const { data, error } = await supabase
      .from("venue_contexts")
      .select("id, name, place_id, poi_codes, context_vector, status, created_at")
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) {
      toast({ title: "Couldn't load places", description: friendlyError(error), variant: "destructive" });
      return;
    }
    setRows(data ?? []);
  };

  useEffect(() => {
    void load();
  }, []);

  const addVenue = async () => {
    const poi = codes.split(",").map((c) => c.trim()).filter(Boolean);
    if (!name.trim() || poi.length === 0) {
      toast({ title: "Add a place name and at least one context tag", variant: "destructive" });
      return;
    }
    const fingerprint = onDeviceFingerprint(poi.map((code) => ({ code, label: code.replace(/[._]/g, " ") })));
    const { error } = await supabase.from("venue_contexts").insert({
      name: name.trim(),
      poi_codes: poi,
      context_vector: fingerprint.scores,
      status: "pilot",
    });
    if (error) {
      toast({ title: "Couldn't save the place", description: friendlyError(error), variant: "destructive" });
      return;
    }
    setName("");
    await load();
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>The sound of a place</CardTitle>
        <CardDescription>
          Give a venue its own sonic character from the field recordings we already licence, so what
          plays there can be matched to the room and the people in it.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <div className="space-y-2">
            <Label htmlFor="venue-name">Place</Label>
            <Input id="venue-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Corner cafe, Austin" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="venue-codes">Context tags</Label>
            <Input id="venue-codes" value={codes} onChange={(e) => setCodes(e.target.value)} />
          </div>
          <Button size="sm" onClick={addVenue}>
            Add place
          </Button>
        </div>

        <div className="space-y-2">
          {rows.length === 0 && <p className="text-sm text-muted-foreground">No places added yet.</p>}
          {rows.map((row) => {
            const vector = (row.context_vector ?? {}) as Record<string, number>;
            return (
              <div key={row.id} className="rounded-md border p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">{row.name}</span>
                  <Badge variant="outline">{row.status}</Badge>
                </div>
                <p className="text-xs text-muted-foreground">{(row.poi_codes ?? []).join(", ")}</p>
                <div className="mt-2 grid grid-cols-3 gap-1 text-xs text-muted-foreground sm:grid-cols-6">
                  {RESONANCE_AXES.map((axis) => (
                    <span key={axis} className="capitalize">
                      {axis.slice(0, 4)} {Math.round(vector[axis] ?? 0)}
                    </span>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
