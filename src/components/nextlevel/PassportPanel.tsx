import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { friendlyError } from "@/lib/friendlyError";
import { AxisVectorEditor } from "./AxisVectorEditor";
import type { AxisVector } from "@/lib/nextlevel/resonance";

interface PassportRow {
  id: string;
  subject_hash: string;
  consent_scopes: string[] | null;
  issued_at: string;
  revoked_at: string | null;
}

/**
 * Sonic Passport (item 6): a portable, signed, revocable profile. Issue, verify
 * and revoke run through the `sonic-passport` function, which seals the payload
 * with a server-held key so any holder can check it without database access.
 */
export function PassportPanel() {
  const [vector, setVector] = useState<AxisVector>({
    emotional: 64,
    cognitive: 57,
    social: 61,
    communication: 45,
    contextual: 72,
    artistic: 59,
  });
  const [scopes, setScopes] = useState("analysis, activation");
  const [issued, setIssued] = useState<{ payload: unknown; signature: string } | null>(null);
  const [rows, setRows] = useState<PassportRow[]>([]);
  const [busy, setBusy] = useState(false);

  const call = async (body: Record<string, unknown>) => {
    const { data, error } = await supabase.functions.invoke("sonic-passport", { body });
    if (error) throw error;
    if (data && (data as { success?: boolean }).success === false) {
      throw new Error(String((data as { error?: string }).error ?? "Request failed"));
    }
    return data as Record<string, unknown>;
  };

  const list = async () => {
    try {
      const data = await call({ action: "list" });
      setRows((data.passports as PassportRow[]) ?? []);
    } catch (err) {
      toast({ title: "Couldn't load passports", description: friendlyError(err), variant: "destructive" });
    }
  };

  useEffect(() => {
    void list();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const issue = async () => {
    setBusy(true);
    try {
      const data = await call({
        action: "issue",
        vector,
        consent_scopes: scopes.split(",").map((s) => s.trim()).filter(Boolean),
      });
      setIssued({ payload: data.passport, signature: String(data.signature) });
      toast({ title: "Passport issued", description: "Signed and recorded." });
      await list();
    } catch (err) {
      toast({ title: "Couldn't issue", description: friendlyError(err), variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const verify = async () => {
    if (!issued) return;
    try {
      const data = await call({
        action: "verify",
        passport: issued.payload as Record<string, unknown>,
        signature: issued.signature,
      });
      toast({
        title: data.active ? "Passport is valid and active" : "Passport failed verification",
        description: data.revoked ? "It has been withdrawn." : undefined,
      });
    } catch (err) {
      toast({ title: "Couldn't verify", description: friendlyError(err), variant: "destructive" });
    }
  };

  const revoke = async (id: string) => {
    try {
      await call({ action: "revoke", passport_id: id });
      toast({ title: "Passport withdrawn" });
      await list();
    } catch (err) {
      toast({ title: "Couldn't withdraw", description: friendlyError(err), variant: "destructive" });
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Sonic Passport</CardTitle>
        <CardDescription>
          A portable profile a person can carry with them and withdraw at any time: the six scores,
          the archetype, what they agreed to, and a seal that proves it wasn't altered.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid gap-6 md:grid-cols-2">
          <AxisVectorEditor title="Profile" value={vector} onChange={setVector} />
          <div className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="passport-scopes">Agreed uses</Label>
              <Input
                id="passport-scopes"
                value={scopes}
                onChange={(e) => setScopes(e.target.value)}
                placeholder="analysis, activation"
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={issue} disabled={busy}>
                {busy ? "Issuing…" : "Issue passport"}
              </Button>
              <Button size="sm" variant="outline" onClick={verify} disabled={!issued}>
                Verify last
              </Button>
            </div>
            {issued && (
              <p className="break-all text-xs text-muted-foreground">
                Seal: {issued.signature.slice(0, 32)}…
              </p>
            )}
          </div>
        </div>

        <div className="space-y-2">
          {rows.length === 0 && <p className="text-sm text-muted-foreground">No passports yet.</p>}
          {rows.map((row) => (
            <div
              key={row.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-2 text-sm"
            >
              <span className="font-mono text-xs">{row.subject_hash}</span>
              <div className="flex items-center gap-2">
                <Badge variant={row.revoked_at ? "destructive" : "secondary"}>
                  {row.revoked_at ? "withdrawn" : "active"}
                </Badge>
                {!row.revoked_at && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => revoke(row.id)}
                    aria-label={`Withdraw passport ${row.subject_hash}`}
                  >
                    Withdraw
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
