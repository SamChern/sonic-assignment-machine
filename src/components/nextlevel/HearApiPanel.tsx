import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { friendlyError } from "@/lib/friendlyError";

interface KeyRow {
  id: string;
  label: string | null;
  key_prefix: string | null;
  scopes: string[] | null;
  last_used_at: string | null;
  revoked_at: string | null;
  created_at: string;
}

const randomKey = () => {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return `hear_${Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("")}`;
};

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * hear() as a tool for other models (item 4). Keys are minted here; only their
 * hash is stored, and the tool itself stays inert until the flag is flipped.
 */
export function HearApiPanel() {
  const [rows, setRows] = useState<KeyRow[]>([]);
  const [label, setLabel] = useState("");
  const [minted, setMinted] = useState<string | null>(null);

  const load = async () => {
    const { data, error } = await supabase
      .from("hear_api_keys")
      .select("id, label, key_prefix, scopes, last_used_at, revoked_at, created_at")
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) {
      toast({ title: "Couldn't load keys", description: friendlyError(error), variant: "destructive" });
      return;
    }
    setRows(data ?? []);
  };

  useEffect(() => {
    void load();
  }, []);

  const mint = async () => {
    const key = randomKey();
    const { error } = await supabase.from("hear_api_keys").insert({
      label: label.trim() || "Unnamed key",
      key_hash: await sha256Hex(key),
      key_prefix: key.slice(0, 12),
      scopes: ["hear"],
    });
    if (error) {
      toast({ title: "Couldn't mint a key", description: friendlyError(error), variant: "destructive" });
      return;
    }
    setMinted(key);
    setLabel("");
    await load();
  };

  const revoke = async (id: string) => {
    const { error } = await supabase
      .from("hear_api_keys")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", id);
    if (error) {
      toast({ title: "Couldn't revoke", description: friendlyError(error), variant: "destructive" });
      return;
    }
    await load();
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>hear() for other systems</CardTitle>
        <CardDescription>
          Lets another assistant ask SonicSIM what a sound is: it answers with the six scores, the
          archetype and the signature. Off until you enable it above.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-2">
            <Label htmlFor="hear-key-label">Key name</Label>
            <Input
              id="hear-key-label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Internal test"
            />
          </div>
          <Button size="sm" onClick={mint}>
            Mint key
          </Button>
        </div>

        {minted && (
          <div className="rounded-md border border-primary/40 bg-primary/5 p-3 text-sm">
            <p className="font-medium">Copy this key now — it is not shown again.</p>
            <p className="mt-1 break-all font-mono text-xs">{minted}</p>
          </div>
        )}

        <div className="space-y-2">
          {rows.length === 0 && <p className="text-sm text-muted-foreground">No keys minted yet.</p>}
          {rows.map((row) => (
            <div
              key={row.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-2 text-sm"
            >
              <span>
                {row.label} <span className="font-mono text-xs text-muted-foreground">{row.key_prefix}…</span>
              </span>
              <div className="flex items-center gap-2">
                <Badge variant={row.revoked_at ? "destructive" : "secondary"}>
                  {row.revoked_at ? "revoked" : "active"}
                </Badge>
                {!row.revoked_at && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => revoke(row.id)}
                    aria-label={`Revoke key ${row.label ?? row.key_prefix ?? ""}`}
                  >
                    Revoke
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
