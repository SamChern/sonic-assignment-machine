import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { ArrowLeft, BadgeCheck, FileAudio, Plus, ShieldOff } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import DivergenceQuadrant from "@/components/creator/DivergenceQuadrant";

/**
 * Step 17 — the Creator door.
 *
 * Understand (fingerprint, divergence, lineage), Register (the Originality
 * Ledger with machine-use terms), Monetize (corpus opt-in and pack receipts).
 * The framing is deliberately honest: SONICSIM sells understanding and
 * provenance today, and pays contributors for corpus use it makes itself.
 */

const TERMS: { value: string; label: string; blurb: string }[] = [
  { value: "no_training", label: "No machine training", blurb: "Excluded from every grounding pack." },
  { value: "analysis_only", label: "Analysis only", blurb: "May inform analysis, never training." },
  { value: "licensable", label: "Available for licensing", blurb: "Eligible for paid corpus use." },
  { value: "public_domain", label: "Public domain contribution", blurb: "No restrictions." },
];

interface Work {
  id: string;
  title: string;
  divergence: number | null;
  resonance: number | null;
  archetype_slug: string | null;
  machine_use_terms: string;
  corpus_opt_in: boolean;
  rights_attested: boolean;
  registered_at: string | null;
  withdrawn_at: string | null;
  embedding_hash: string | null;
}

interface Inclusion {
  pack_version: string;
  work_id: string;
  analyses_influenced: number | null;
}

const CreatorDoor = () => {
  const { user, loading } = useAuth();
  const [works, setWorks] = useState<Work[]>([]);
  const [inclusions, setInclusions] = useState<Inclusion[]>([]);
  const [title, setTitle] = useState("");
  const [terms, setTerms] = useState("analysis_only");
  const [attested, setAttested] = useState(false);
  const [optIn, setOptIn] = useState(false);
  const [busy, setBusy] = useState(false);


  const load = useCallback(async () => {
    if (!user) return;
    const { data, error } = await supabase
      .from("creator_works")
      .select(
        "id,title,divergence,resonance,archetype_slug,machine_use_terms,corpus_opt_in,rights_attested,registered_at,withdrawn_at,embedding_hash",
      )
      .order("created_at", { ascending: false });
    if (error) {
      toast.error("Couldn't load your works.");
      return;
    }
    const rows = (data ?? []) as unknown as Work[];
    setWorks(rows);
    if (rows.length) {
      const { data: inc } = await supabase
        .from("pack_inclusions")
        .select("pack_version,work_id,analyses_influenced")
        .in(
          "work_id",
          rows.map((r) => r.id),
        );
      setInclusions((inc ?? []) as unknown as Inclusion[]);
    } else {
      setInclusions([]);
    }
  }, [user]);

  useEffect(() => {
    void load();
  }, [load]);

  const register = async () => {
    if (!user || !title.trim() || !attested) return;
    setBusy(true);
    const { data, error } = await supabase
      .from("creator_works")
      .insert({
        user_id: user.id,
        title: title.trim(),
        rights_attested: true,
        machine_use_terms: terms,
        corpus_opt_in: optIn,
        registered_at: new Date().toISOString(),
      })
      .select("id")
      .maybeSingle();
    if (error || !data) {
      setBusy(false);
      toast.error(error?.message ?? "Registration failed.");
      return;
    }
    // Append-only ledger: the registration event, never the audio.
    await supabase.from("originality_ledger").insert({
      work_id: data.id,
      event_type: "registered",
      payload: { machine_use_terms: terms, corpus_opt_in: optIn, attested: true },
    });
    setBusy(false);
    setTitle("");
    setAttested(false);
    toast.success("Work registered in the Originality Ledger.");
    void load();
  };

  const setWorkTerms = async (work: Work, next: string) => {
    const { error } = await supabase
      .from("creator_works")
      .update({ machine_use_terms: next })
      .eq("id", work.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    await supabase.from("originality_ledger").insert({
      work_id: work.id,
      event_type: "terms_changed",
      payload: { from: work.machine_use_terms, to: next },
    });
    void load();
  };

  const withdraw = async (work: Work) => {
    const now = new Date().toISOString();
    const { error } = await supabase
      .from("creator_works")
      .update({ withdrawn_at: now, corpus_opt_in: false })
      .eq("id", work.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    await supabase
      .from("originality_ledger")
      .insert({ work_id: work.id, event_type: "withdrawn", payload: { at: now } });
    toast.success("Withdrawn from future packs. Past packs stay on the record.");
    void load();
  };

  const toggleOptIn = async (work: Work) => {
    const next = !work.corpus_opt_in;
    const { error } = await supabase
      .from("creator_works")
      .update({ corpus_opt_in: next })
      .eq("id", work.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    await supabase
      .from("originality_ledger")
      .insert({ work_id: work.id, event_type: next ? "corpus_opt_in" : "corpus_opt_out", payload: {} });
    void load();
  };

  const receipts = useMemo(() => {
    const byWork = new Map<string, { packs: string[]; analyses: number }>();
    inclusions.forEach((i) => {
      const cur = byWork.get(i.work_id) ?? { packs: [], analyses: 0 };
      cur.packs.push(i.pack_version);
      cur.analyses += i.analyses_influenced ?? 0;
      byWork.set(i.work_id, cur);
    });
    return byWork;
  }, [inclusions]);

  // The Originality Ledger is an account-bound record: registration requires a
  // real signed-in creator, never a guest session.
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center gradient-app">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex min-h-screen items-center justify-center gradient-app px-4">
        <Card className="w-full max-w-md space-y-4 border-border/60 bg-card/80 p-6 backdrop-blur">
          <div className="flex items-center gap-2">
            <BadgeCheck className="h-5 w-5 text-primary" />
            <h1 className="text-base font-semibold">Creator door</h1>
          </div>
          <p className="text-sm text-muted-foreground">
            The Originality Ledger records who registered a work and when, so it needs a real
            creator account. Sign in, or create one in a few seconds — your works, terms and
            attribution receipts all stay attached to it.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button asChild size="sm">
              <Link to="/auth?next=%2Fcreator&mode=signup">Create a creator account</Link>
            </Button>
            <Button asChild size="sm" variant="outline">
              <Link to="/auth?next=%2Fcreator">Sign in</Link>
            </Button>
            <Button asChild size="sm" variant="ghost">
              <Link to="/">
                <ArrowLeft className="mr-1 h-4 w-4" /> Home
              </Link>
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="relative min-h-screen gradient-app">
      <header className="sticky top-0 z-30 border-b border-border/60 bg-background/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3">
          <div>
            <h1 className="text-base font-semibold sm:text-lg">Creator door</h1>
            <p className="text-xs text-muted-foreground">
              Understand your work, register its provenance, choose how machines may use it.
            </p>
          </div>
          <Button asChild variant="ghost" size="sm">
            <Link to="/">
              <ArrowLeft className="mr-1 h-4 w-4" />
              Home
            </Link>
          </Button>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-6 pb-mobile-nav sm:px-6">
        <Tabs defaultValue="register">
          <TabsList className="grid w-full grid-cols-3 border border-border/60 bg-card/70 p-1 backdrop-blur-sm">
            <TabsTrigger value="understand" className="text-xs sm:text-sm">
              Understand
            </TabsTrigger>
            <TabsTrigger value="register" className="text-xs sm:text-sm">
              Register
            </TabsTrigger>
            <TabsTrigger value="monetize" className="text-xs sm:text-sm">
              Monetize
            </TabsTrigger>
          </TabsList>

          <TabsContent value="understand" className="mt-4 space-y-4">
            <DivergenceQuadrant
              points={works.map((w) => ({
                id: w.id,
                title: w.title,
                divergence: w.divergence,
                resonance: w.resonance,
              }))}
            />
            <Card className="border-border/60 bg-card/70 p-4 backdrop-blur-sm">
              <h3 className="text-sm font-semibold">Lineage</h3>
              <p className="text-xs text-muted-foreground">
                Nearest regions of the grounded space use historical and archetypal anchors only —
                never living-artist comparisons.
              </p>
              <ul className="mt-2 space-y-1 text-xs">
                {works
                  .filter((w) => w.archetype_slug)
                  .map((w) => (
                    <li key={w.id} className="text-muted-foreground">
                      <span className="text-foreground">{w.title}</span> — in the lineage of{" "}
                      {w.archetype_slug}
                    </li>
                  ))}
                {works.every((w) => !w.archetype_slug) && (
                  <li className="text-muted-foreground">No anchors yet — analyze a work first.</li>
                )}
              </ul>
            </Card>
          </TabsContent>

          <TabsContent value="register" className="mt-4 space-y-4">
            <Card className="border-border/60 bg-card/70 p-4 backdrop-blur-sm">
              <h3 className="text-sm font-semibold">Register a work</h3>
              <p className="mb-3 text-xs text-muted-foreground">
                We store a content-derived fingerprint and a timestamp — never your audio. You are
                confirming you hold the rights to this work.
              </p>
              <div className="space-y-3">
                <Input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Work title"
                  className="h-9"
                />
                <Select value={terms} onValueChange={setTerms}>
                  <SelectTrigger className="h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TERMS.map((t) => (
                      <SelectItem key={t.value} value={t.value}>
                        {t.label} — {t.blurb}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <label className="flex items-start gap-2 text-xs text-muted-foreground">
                  <Checkbox
                    checked={attested}
                    onCheckedChange={(v) => setAttested(v === true)}
                    aria-label="Rights attestation"
                  />
                  I hold or control the rights to this work and accept liability for this
                  attestation.
                </label>
                <label className="flex items-start gap-2 text-xs text-muted-foreground">
                  <Checkbox
                    checked={optIn}
                    onCheckedChange={(v) => setOptIn(v === true)}
                    aria-label="Corpus opt-in"
                  />
                  Opt this work into the Grounding Corpus (revenue share on licensed use).
                </label>
                <Button size="sm" onClick={register} disabled={busy || !attested || !title.trim()}>
                  <Plus className="mr-1 h-4 w-4" />
                  Register
                </Button>
              </div>
            </Card>

            <Card className="border-border/60 bg-card/70 p-4 backdrop-blur-sm">
              <h3 className="mb-2 text-sm font-semibold">Your works</h3>
              {works.length === 0 ? (
                <p className="text-xs text-muted-foreground">Nothing registered yet.</p>
              ) : (
                <ul className="space-y-2">
                  {works.map((w) => (
                    <li
                      key={w.id}
                      className="flex flex-wrap items-center gap-2 rounded-lg border border-border/50 bg-background/40 p-3"
                    >
                      <FileAudio className="h-4 w-4 shrink-0 text-primary" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{w.title}</p>
                        <p className="text-xs text-muted-foreground">
                          {w.registered_at
                            ? `registered ${new Date(w.registered_at).toLocaleDateString()}`
                            : "not registered"}
                          {w.withdrawn_at
                            ? ` · withdrawn ${new Date(w.withdrawn_at).toLocaleDateString()}`
                            : ""}
                        </p>
                      </div>
                      <Select
                        value={w.machine_use_terms}
                        onValueChange={(v) => void setWorkTerms(w, v)}
                      >
                        <SelectTrigger className="h-8 w-[190px] text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {TERMS.map((t) => (
                            <SelectItem key={t.value} value={t.value}>
                              {t.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {w.rights_attested && (
                        <Badge variant="outline" className="gap-1 text-[11px]">
                          <BadgeCheck className="h-3 w-3" />
                          attested
                        </Badge>
                      )}
                      {!w.withdrawn_at && (
                        <Button size="sm" variant="ghost" onClick={() => withdraw(w)}>
                          <ShieldOff className="mr-1 h-3.5 w-3.5" />
                          Withdraw
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </TabsContent>

          <TabsContent value="monetize" className="mt-4 space-y-4">
            <Card className="border-border/60 bg-card/70 p-4 backdrop-blur-sm">
              <h3 className="text-sm font-semibold">Two paths, never blurred</h3>
              <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
                <li>
                  <Badge variant="outline" className="mr-1 text-[11px]">
                    live now
                  </Badge>
                  SONICSIM licenses the corpus for its own packs and enterprise products, and pays
                  contributors.
                </li>
                <li>
                  <Badge variant="outline" className="mr-1 text-[11px]">
                    built for
                  </Badge>
                  External dataset licensing with SONICSIM as clearinghouse.
                </li>
              </ul>
            </Card>

            <Card className="border-border/60 bg-card/70 p-4 backdrop-blur-sm">
              <h3 className="mb-2 text-sm font-semibold">Attribution receipts</h3>
              {works.length === 0 ? (
                <p className="text-xs text-muted-foreground">Register a work to see receipts.</p>
              ) : (
                <ul className="space-y-2 text-xs">
                  {works.map((w) => {
                    const r = receipts.get(w.id);
                    return (
                      <li
                        key={w.id}
                        className="flex flex-wrap items-center gap-2 rounded-lg border border-border/50 bg-background/40 p-3"
                      >
                        <span className="min-w-0 flex-1 truncate text-foreground">{w.title}</span>
                        <span className="text-muted-foreground">
                          {r
                            ? `in ${r.packs.join(", ")} · ${r.analyses.toLocaleString()} analyses influenced`
                            : w.machine_use_terms === "no_training"
                              ? "excluded from all packs by your terms"
                              : "not yet in a pack"}
                        </span>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => toggleOptIn(w)}
                          disabled={!!w.withdrawn_at}
                        >
                          {w.corpus_opt_in ? "Opted in" : "Opt in"}
                        </Button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Card>
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
};

export default CreatorDoor;
