/**
 * Step 16a — the Consumer door: one input, one result, one ladder.
 *
 * A single universal input (search words, a pasted link, a mood in plain
 * English, or a dropped file) hits the same `analyze-audio` path everything
 * else uses. The result view shows the six-axis fingerprint, the archetype +
 * :03 signature, one plain-language sentence, exactly one "How it heard this"
 * expander, a share card with a permalink, and the cohort upsell computed from
 * the user's own result.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import {
  ChevronDown,
  Link2,
  Loader2,
  Search,
  Share2,
  Sparkles,
  Upload,
  Users,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { GroundingBadge } from "@/components/GroundingBadge";
import { SignatureCard } from "@/components/SignatureCard";
import CohortUpsellCard from "@/components/home/CohortUpsellCard";
import { supabase } from "@/integrations/supabase/client";
import { invokeWithTimeout } from "@/lib/invokeWithTimeout";
import type { AnalyzeAudioResponse } from "@/lib/analyzeAudio";
import { AUDIOSCOPE_CATEGORIES, categoryToken } from "@/lib/audioscope";
import { calculateSimilarity, type FingerprintLike } from "@/lib/fingerprintMath";
import type { UserFingerprint } from "@/hooks/useFingerprints";
import type { SignatureVector } from "@/lib/signature/mapping";

type Scores = Record<string, number>;

interface DoorResult {
  id?: string;
  name: string;
  scores: Scores;
  descriptions: Record<string, string>;
  groundingLevel?: "text-only" | "bridged" | "grounded";
  tags: string[];
}


const GUEST_RUNS_KEY = "sonicsim.guestRuns";
const GUEST_LIMIT = 1;
const FREE_MONTHLY_LIMIT = 3;

const readGuestRuns = () => {
  try {
    return Number(localStorage.getItem(GUEST_RUNS_KEY)) || 0;
  } catch {
    return 0;
  }
};

const label = (c: string) => c.charAt(0).toUpperCase() + c.slice(1);

const toVector = (scores: Scores): SignatureVector =>
  AUDIOSCOPE_CATEGORIES.reduce((acc, c) => {
    acc[c as keyof SignatureVector] = Number(scores[c]) || 0;
    return acc;
  }, {} as SignatureVector);

const toFingerprintLike = (scores: Scores): FingerprintLike =>
  ({
    emotional_avg: scores.emotional || 0,
    cognitive_avg: scores.cognitive || 0,
    social_avg: scores.social || 0,
    communication_avg: scores.communication || 0,
    contextual_avg: scores.contextual || 0,
    artistic_avg: scores.artistic || 0,
  }) as FingerprintLike;

/** One honest sentence: the two loudest axes and the quietest one. */
const plainSentence = (result: DoorResult) => {
  const ranked = AUDIOSCOPE_CATEGORIES.map((c) => ({ c, v: Number(result.scores[c]) || 0 })).sort(
    (a, b) => b.v - a.v,
  );
  const [first, second] = ranked;
  const last = ranked[ranked.length - 1];
  return `It reads as mostly ${label(first.c).toLowerCase()} with a strong ${label(
    second.c,
  ).toLowerCase()} undertow, and very little ${label(last.c).toLowerCase()} weight.`;
};

export const ConsumerDoor = ({
  isSignedIn,
  userId,
  allFingerprints,
}: {
  isSignedIn: boolean;
  userId: string | null;
  allFingerprints: UserFingerprint[];
}) => {
  const [searchParams, setSearchParams] = useSearchParams();
  const [query, setQuery] = useState("");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<DoorResult | null>(null);
  const [monthlyUsed, setMonthlyUsed] = useState<number | null>(null);
  const [guestRuns, setGuestRuns] = useState(() => readGuestRuns());
  const [shareError, setShareError] = useState<string | null>(null);
  const [quotaError, setQuotaError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const sharedId = searchParams.get("share");

  // How many free runs are left in this door.
  useEffect(() => {
    if (!userId) {
      setMonthlyUsed(null);
      return;
    }
    let cancelled = false;
    const start = new Date();
    start.setDate(1);
    start.setHours(0, 0, 0, 0);
    void (async () => {
      const { count, error } = await supabase
        .from("source_analyses")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .gte("created_at", start.toISOString());
      if (cancelled) return;
      if (error) {
        // Unknown usage must not silently look like "quota exhausted".
        console.error("monthly usage lookup failed", error);
        setQuotaError("We couldn't check your monthly usage — showing your allowance as unused.");
        setMonthlyUsed(0);
        return;
      }
      setQuotaError(null);
      setMonthlyUsed(count ?? 0);
    })();
    return () => {
      cancelled = true;
    };
  }, [userId, result]);

  const quotaExhausted = isSignedIn
    ? (monthlyUsed ?? 0) >= FREE_MONTHLY_LIMIT
    : guestRuns >= GUEST_LIMIT;

  const remaining = isSignedIn
    ? Math.max(0, FREE_MONTHLY_LIMIT - (monthlyUsed ?? 0))
    : Math.max(0, GUEST_LIMIT - guestRuns);

  // A shared permalink renders the same result view, read-only.
  useEffect(() => {
    if (!sharedId) return;
    let cancelled = false;
    void (async () => {
      const { data, error } = await supabase
        .from("source_analyses")
        .select("*")
        .eq("id", sharedId)
        .maybeSingle();
      if (cancelled) return;
      if (error || !data) {
        setShareError(
          error
            ? "We couldn't open that shared SonicSIM. Try the link again."
            : "That shared SonicSIM isn't available any more.",
        );
        return;
      }
      setShareError(null);
      const scores: Scores = {};
      const descriptions: Record<string, string> = {};
      for (const c of AUDIOSCOPE_CATEGORIES) {
        scores[c] = Number((data as never as Record<string, unknown>)[`${c}_score`]) || 0;
        descriptions[c] = String(
          (data as never as Record<string, unknown>)[`${c}_desc`] ?? "",
        );
      }
      setResult({
        id: data.id,
        name: data.source_name,
        scores,
        descriptions,
        groundingLevel: (data.grounding_level as DoorResult["groundingLevel"]) ?? undefined,
        tags: data.category ? [data.category] : [],
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [sharedId]);

  const run = useCallback(
    async (source: { name: string; type: "file" | "track" }) => {
      if (quotaExhausted) return;
      setRunning(true);
      setResult(null);
      try {
        // Bounded so a stalled edge function surfaces as an error instead of an
        // endless spinner.
        const { data, error } = await invokeWithTimeout<AnalyzeAudioResponse>("analyze-audio", {
          body: { sources: [source], user_id: userId ?? undefined, save_results: !!userId },
        });
        if (error) throw error;
        if (data?.error) throw new Error(String(data.error));
        const first = data?.sources?.[0];
        if (!first) throw new Error("No result came back — try again.");

        const scores: Scores = {};
        const descriptions: Record<string, string> = {};
        for (const cat of first.categories ?? []) {
          const key = String(cat.name).toLowerCase();
          scores[key] = Number(cat.score) || 0;
          descriptions[key] = String(cat.description ?? "");
        }

        let savedId: string | undefined;
        if (userId) {
          const { data: saved } = await supabase
            .from("source_analyses")
            .select("id")
            .eq("user_id", userId)
            .eq("source_name", first.name)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();
          savedId = saved?.id;
        }

        setResult({
          id: savedId,
          name: first.name,
          scores,
          descriptions,
          groundingLevel: first.grounding_level,
          tags: Array.isArray(first.tags) ? first.tags.map(String) : [],
        });
        if (!isSignedIn) {
          const next = readGuestRuns() + 1;
          try {
            localStorage.setItem(GUEST_RUNS_KEY, String(next));
          } catch {
            /* ignore */
          }
          setGuestRuns(next);
        }
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Analysis failed.");
      } finally {
        setRunning(false);
      }
    },
    [isSignedIn, quotaExhausted, userId],
  );

  const submitText = () => {
    const text = query.trim();
    if (!text) {
      toast.error("Type a song, paste a link, or describe a mood.");
      return;
    }
    void run({ name: text, type: "track" });
  };

  const cohorts = useMemo(() => {
    if (!result) return [];
    const me = toFingerprintLike(result.scores);
    return allFingerprints
      .map((fp) => ({ fp, similarity: calculateSimilarity(me, fp as never) }))
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, 2);
  }, [result, allFingerprints]);

  const share = async () => {
    const url = result?.id
      ? `${window.location.origin}/?share=${result.id}`
      : window.location.origin;
    try {
      if (navigator.share) {
        await navigator.share({ title: "My SonicSIM", url });
      } else {
        await navigator.clipboard.writeText(url);
        toast.success("Permalink copied");
      }
    } catch {
      /* user dismissed */
    }
    if (!result?.id) {
      toast.info("Sign in to save this result and get a permanent link.");
    }
  };

  const clearShared = () => {
    if (!sharedId) return;
    const params = new URLSearchParams(searchParams);
    params.delete("share");
    setSearchParams(params, { replace: true });
    setResult(null);
  };

  return (
    <section aria-labelledby="consumer-door-heading" className="space-y-6">
      <h2 id="consumer-door-heading" className="sr-only">
        Analyze one piece of audio
      </h2>

      {/* One door, many keys */}
      <Card className="border-primary/25 bg-card/70 p-4 backdrop-blur-sm sm:p-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submitText()}
              placeholder="A song, a link, or how it should feel — “rainy Sunday, driving, thinking”"
              className="h-12 pl-9 text-base"
              aria-label="Song, link, or mood"
            />
          </div>
          <div className="flex gap-2">
            <Button
              className="h-12 flex-1 gradient-primary sm:flex-none"
              onClick={submitText}
              disabled={running || quotaExhausted}
            >
              {running ? (
                <Loader2 className="mr-2 h-5 w-5 animate-spin" />
              ) : (
                <Sparkles className="mr-2 h-5 w-5" />
              )}
              {running ? "Listening…" : "Hear it"}
            </Button>
            <Button
              variant="outline"
              className="h-12 min-w-12"
              aria-label="Upload an audio file"
              onClick={() => fileRef.current?.click()}
              disabled={running || quotaExhausted}
            >
              <Upload className="h-5 w-5" />
            </Button>
          </div>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="audio/*"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void run({ name: file.name, type: "file" });
            e.currentTarget.value = "";
          }}
        />
        <p className="mt-3 text-xs text-muted-foreground">
          {quotaExhausted ? (
            isSignedIn ? (
              <>
                You've used your {FREE_MONTHLY_LIMIT} free analyses this month.{" "}
                <Link to="/workspace" className="text-primary underline-offset-4 hover:underline">
                  See what this does at scale
                </Link>
                .
              </>
            ) : (
              <>
                That was your free look.{" "}
                <Link to="/auth" className="text-primary underline-offset-4 hover:underline">
                  Create a free account
                </Link>{" "}
                to save, share, and run {FREE_MONTHLY_LIMIT} a month.
              </>
            )
          ) : (
            <>
              {remaining} free {remaining === 1 ? "analysis" : "analyses"} left
              {isSignedIn ? " this month" : " — no signup needed"}.
            </>
          )}
        </p>
        {quotaError && (
          <p role="status" className="mt-2 text-xs text-muted-foreground">
            {quotaError}
          </p>
        )}
      </Card>

      {shareError && (
        <Card role="alert" className="border-destructive/40 bg-destructive/5 p-4">
          <p className="text-sm text-destructive">{shareError}</p>
        </Card>
      )}

      {/* One result view */}
      {result && (
        <div className="space-y-4">
          {sharedId && (
            <div className="flex items-center justify-between gap-3 rounded-lg border border-primary/25 bg-primary/5 px-3 py-2 text-sm">
              <span className="flex items-center gap-2 text-muted-foreground">
                <Link2 className="h-4 w-4 text-primary" />
                Shared SonicSIM
              </span>
              <Button variant="ghost" size="sm" onClick={clearShared}>
                Try my own
              </Button>
            </div>
          )}

          <Card className="p-4 sm:p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <h3 className="truncate text-lg font-bold text-foreground sm:text-xl">
                  {result.name}
                </h3>
                <p className="mt-1 text-sm text-muted-foreground">{plainSentence(result)}</p>
              </div>
              <GroundingBadge level={result.groundingLevel} />
            </div>

            <div className="mt-4 space-y-2.5">
              {AUDIOSCOPE_CATEGORIES.map((c) => (
                <div key={c} className="min-w-0">
                  <div className="mb-1 flex items-center justify-between text-xs">
                    <span className="font-medium text-foreground">{label(c)}</span>
                    <span className="tabular-nums text-muted-foreground">
                      {Math.round(Number(result.scores[c]) || 0)}
                    </span>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full transition-all duration-500"
                      style={{
                        width: `${Math.max(2, Math.min(100, Number(result.scores[c]) || 0))}%`,
                        backgroundColor: categoryToken(c),
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>

            {/* Progressive disclosure — exactly one level deep */}
            <Collapsible className="mt-4">
              <CollapsibleTrigger className="flex w-full items-center justify-between rounded-lg border border-border px-3 py-2 text-sm text-muted-foreground hover:text-foreground">
                <span>How it heard this</span>
                <ChevronDown className="h-4 w-4" />
              </CollapsibleTrigger>
              <CollapsibleContent className="space-y-2 px-1 pt-3 text-sm text-muted-foreground">
                {result.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {result.tags.slice(0, 8).map((t) => (
                      <Badge key={t} variant="secondary" className="text-xs">
                        {t}
                      </Badge>
                    ))}
                  </div>
                )}
                {AUDIOSCOPE_CATEGORIES.filter((c) => result.descriptions[c]).map((c) => (
                  <p key={c}>
                    <span className="font-medium text-foreground">{label(c)}:</span>{" "}
                    {result.descriptions[c]}
                  </p>
                ))}
              </CollapsibleContent>
            </Collapsible>

            <div className="mt-4 flex flex-wrap gap-2">
              <Button variant="outline" size="sm" className="gap-2" onClick={() => void share()}>
                <Share2 className="h-4 w-4" />
                Share my SonicSIM
              </Button>
            </div>
          </Card>

          {/* Archetype + :03 signature */}
          <SignatureCard
            vector={toVector(result.scores)}
            tags={result.tags}
            subjectRef={result.id ?? result.name}
          />

          {/* The ladder: the upsell is the demo, run on their own result */}
          <CohortUpsellCard cohorts={cohorts} />
        </div>
      )}
    </section>
  );
};

export default ConsumerDoor;
