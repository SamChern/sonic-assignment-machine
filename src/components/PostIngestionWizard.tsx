import { useCallback, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import InferenceConfigGuard from "@/components/InferenceConfigGuard";
import { useInferenceReadiness } from "@/hooks/useInferenceReadiness";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/use-toast";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertTriangle,
  CheckCircle2,
  CircleDashed,
  Loader2,
  Play,
  RefreshCw,
  Search,
  Wand2,
} from "lucide-react";

/* ------------------------------------------------------------------ types */

interface ActivationFile {
  object_key: string;
  report_type: string | null;
  size: number;
  prefix: string;
  status: string | null;
  total_rows: number | null;
  processed_rows: number | null;
  finished_at: string | null;
  error_message: string | null;
}

interface Activation {
  activation_id: string;
  files: ActivationFile[];
  empty_files: number;
  total_bytes: number;
  done_files: number;
}

type StageState = "idle" | "running" | "ok" | "warn" | "error";

interface StageResult {
  state: StageState;
  summary: string;
  /** Rendered as a compact key/value output grid. */
  outputs?: [string, string][];
  notes?: string[];
}

const STAGES = [
  ["discover", "Discover delivery"],
  ["ingest", "Ingest + normalize"],
  ["source", "Source + taxonomy tags"],
  ["score", "Semantic scoring"],
  ["link", "Audience linkage"],
] as const;

type StageKey = typeof STAGES[number][0];

const SCORE_FIELDS = [
  ["emotional_score", "Emotional"],
  ["cognitive_score", "Cognitive"],
  ["social_score", "Social"],
  ["communication_score", "Communication"],
  ["contextual_score", "Contextual"],
  ["artistic_score", "Artistic"],
] as const;

const bytes = (n: number) =>
  n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`;

const fileName = (key: string) => key.split("/").pop() ?? key;

const StageIcon = ({ state }: { state: StageState }) => {
  if (state === "running") return <Loader2 className="h-4 w-4 animate-spin text-primary" />;
  if (state === "ok") return <CheckCircle2 className="h-4 w-4 text-primary" />;
  if (state === "warn") return <AlertTriangle className="h-4 w-4 text-amber-500" />;
  if (state === "error") return <AlertTriangle className="h-4 w-4 text-destructive" />;
  return <CircleDashed className="h-4 w-4 text-muted-foreground" />;
};

/* ------------------------------------------------------------- component */

const PostIngestionWizard = () => {
  const [activations, setActivations] = useState<Activation[]>([]);
  const [selected, setSelected] = useState<string>("");
  const [discovering, setDiscovering] = useState(false);
  const [running, setRunning] = useState(false);
  const {
    readiness,
    loading: inferenceLoading,
    error: inferenceError,
    blocked: inferenceBlocked,
    recheck,
  } = useInferenceReadiness();
  const [results, setResults] = useState<Partial<Record<StageKey, StageResult>>>({});

  const activation = useMemo(
    () => activations.find((a) => a.activation_id === selected),
    [activations, selected],
  );

  const setStage = (key: StageKey, value: StageResult) =>
    setResults((prev) => ({ ...prev, [key]: value }));

  /** Step 0 — list inbound objects grouped by activation id. */
  const discover = useCallback(async () => {
    setDiscovering(true);
    const { data, error } = await supabase.functions.invoke("intuizi-ingest", {
      body: { action: "activations" },
    });
    setDiscovering(false);

    if (error) {
      toast({ title: "Could not list activations", description: error.message, variant: "destructive" });
      return;
    }
    const list = ((data as { activations?: Activation[] })?.activations ?? []).filter(
      (a) => a.files.length > 0,
    );
    setActivations(list);
    setResults({});
    if (!list.length) {
      toast({ title: "No inbound objects found", description: "Nothing is waiting under the Intuizi prefixes." });
      return;
    }
    if (!list.some((a) => a.activation_id === selected)) setSelected(list[0].activation_id);
  }, [selected]);

  /** Steps 1-4 — run the semantic pipeline for the selected activation. */
  const run = useCallback(async () => {
    if (!activation) return;
    setRunning(true);
    setResults({});

    const dataFiles = activation.files.filter((f) => f.size > 64);
    const emptyFiles = activation.files.filter((f) => f.size <= 64);

    // --- Stage: discover ---------------------------------------------------
    setStage("discover", {
      state: dataFiles.length ? "ok" : "warn",
      summary: dataFiles.length
        ? `${dataFiles.length} file${dataFiles.length === 1 ? "" : "s"} with rows · ${bytes(activation.total_bytes)}`
        : "every file in this activation is header-only — nothing to process",
      outputs: activation.files.map((f) => [
        fileName(f.object_key),
        `${f.report_type ?? "?"} · ${bytes(f.size)}${f.size <= 64 ? " · empty" : ""}`,
      ]),
      notes: emptyFiles.length
        ? [`${emptyFiles.length} header-only file(s) skipped — re-export these from the Intuizi console.`]
        : undefined,
    });

    if (!dataFiles.length) {
      setRunning(false);
      return;
    }

    // --- Stage: ingest -----------------------------------------------------
    setStage("ingest", { state: "running", summary: "processing files…" });
    const perFile: [string, string][] = [];
    const ingestErrors: string[] = [];
    let rowsRead = 0;
    let scored = 0;
    let roster = 0;

    for (const f of dataFiles) {
      const { data, error } = await supabase.functions.invoke("intuizi-ingest", {
        body: { object_key: f.object_key, report_type: f.report_type ?? undefined },
      });
      if (error) {
        ingestErrors.push(`${fileName(f.object_key)}: ${error.message}`);
        perFile.push([fileName(f.object_key), "failed"]);
        continue;
      }
      const res = data as {
        rows_read?: number;
        identifiers_scored?: number;
        roster_identifiers?: number;
        errors?: string[];
      };
      rowsRead += res.rows_read ?? 0;
      scored += res.identifiers_scored ?? 0;
      roster += res.roster_identifiers ?? 0;
      if (res.errors?.length) ingestErrors.push(...res.errors);
      perFile.push([
        fileName(f.object_key),
        `${res.rows_read ?? 0} rows · ${res.identifiers_scored ?? 0} scored · ${res.roster_identifiers ?? 0} roster`,
      ]);
    }

    setStage("ingest", {
      state: ingestErrors.length ? (rowsRead ? "warn" : "error") : "ok",
      summary: `${rowsRead} rows read · ${scored} profile(s) scored · ${roster} identifier(s) registered`,
      outputs: perFile,
      notes: ingestErrors.length ? ingestErrors : undefined,
    });

    // --- Stage: source + tags ---------------------------------------------
    setStage("source", { state: "running", summary: "resolving activation profile…" });
    const { data: profileRow } = await supabase
      .from("intuizi_identifiers")
      .select("audio_source_id")
      .eq("primary_identifier", `activation:${activation.activation_id}`)
      .maybeSingle();
    const sourceId = profileRow?.audio_source_id ?? null;

    if (!sourceId) {
      setStage("source", {
        state: "warn",
        summary: "no activation profile was created",
        notes: [
          "This delivery carried no taxonomy content (device rosters only), so there is nothing to score. Ingest the matching summary or signals report for this activation id.",
        ],
      });
      setStage("score", { state: "idle", summary: "waiting on a scored profile" });
      setStage("link", { state: "idle", summary: "waiting on a scored profile" });
      setRunning(false);
      return;
    }

    const [srcRes, tagRes] = await Promise.all([
      supabase
        .from("audio_sources")
        .select("id, name, source_type, analysis_status, analysis_error, profile_embedding, created_at")
        .eq("id", sourceId)
        .maybeSingle(),
      supabase
        .from("audio_source_tags")
        .select("weight, taxonomy_nodes(code, label)")
        .eq("audio_source_id", sourceId)
        .order("weight", { ascending: false }),
    ]);

    const src = srcRes.data as
      | {
          name: string;
          source_type: string;
          analysis_status: string;
          analysis_error: string | null;
          profile_embedding: unknown | null;
        }
      | null;
    const tags = (tagRes.data ?? []) as unknown as {
      weight: number;
      taxonomy_nodes: { code: string; label: string } | null;
    }[];

    setStage("source", {
      state: src ? (src.analysis_status === "failed" ? "error" : "ok") : "warn",
      summary: src
        ? `${src.name} · ${src.source_type} · ${src.analysis_status}${src.profile_embedding ? " · embedded" : ""}`
        : "audio source row not found",
      outputs: [
        ["Taxonomy tags", String(tags.length)],
        ...tags.slice(0, 8).map(
          (t) =>
            [t.taxonomy_nodes?.code ?? "unresolved", `weight ${Number(t.weight).toFixed(2)}`] as [
              string,
              string,
            ],
        ),
      ],
      notes: src?.analysis_error ? [src.analysis_error] : undefined,
    });

    // --- Stage: scoring ----------------------------------------------------
    setStage("score", { state: "running", summary: "reading ontology scores…" });
    const { data: ana } = await supabase
      .from("source_analyses")
      .select(
        "category, confidence, created_at, emotional_score, cognitive_score, social_score, communication_score, contextual_score, artistic_score",
      )
      .eq("audio_source_id", sourceId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (ana) {
      const conf = Number(ana.confidence ?? 0);
      setStage("score", {
        state: conf < 0.35 ? "warn" : "ok",
        summary: `${ana.category ?? "uncategorized"} · confidence ${conf.toFixed(2)}`,
        outputs: SCORE_FIELDS.map(
          ([k, label]) => [label, String(Math.round(Number(ana[k])))] as [string, string],
        ),
        notes:
          conf < 0.35
            ? ["Low confidence — thin taxonomy evidence. Request per-device signal detail for a stronger profile."]
            : undefined,
      });
    } else {
      setStage("score", {
        state: "error",
        summary: "no analysis row was produced",
        notes: ["The profile exists but analyze-audio did not return scores. Re-run the ingest for this activation."],
      });
    }

    // --- Stage: audience linkage ------------------------------------------
    setStage("link", { state: "running", summary: "counting linked identifiers…" });
    const { count } = await supabase
      .from("intuizi_identifiers")
      .select("id", { count: "exact", head: true })
      .eq("audio_source_id", sourceId);

    setStage("link", {
      state: (count ?? 0) > 1 ? "ok" : "warn",
      summary: `${count ?? 0} identifier(s) linked to this profile`,
      outputs: [
        ["Activation profile", `activation:${activation.activation_id}`],
        ["Devices / emails joined", String(Math.max(0, (count ?? 0) - 1))],
      ],
      notes:
        (count ?? 0) > 1
          ? undefined
          : ["No device roster is linked yet — ingest the maid/hem delivery for this activation id."],
    });

    setRunning(false);
  }, [activation]);

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-center gap-2">
        <Wand2 className="h-5 w-5 text-primary" />
        <h2 className="text-base font-semibold">Guided data stream wizard</h2>
        <Badge variant="outline" className="text-[11px]">admin only</Badge>
        <Button
          variant="outline"
          size="sm"
          className="ml-auto"
          onClick={discover}
          disabled={discovering || running}
        >
          {discovering ? (
            <Loader2 className="mr-1 h-4 w-4 animate-spin" />
          ) : (
            <Search className="mr-1 h-4 w-4" />
          )}
          {activations.length ? "Rescan bucket" : "Find activations"}
        </Button>
      </div>

      <p className="mt-2 text-xs text-muted-foreground">
        Pick an Intuizi activation id, then run the semantic stages in order: ingest and normalize the
        delivery, build the activation profile with taxonomy tags, score it through the ontology, and
        join the device roster.
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Select value={selected} onValueChange={setSelected} disabled={!activations.length || running}>
          <SelectTrigger className="w-full max-w-md">
            <SelectValue placeholder={activations.length ? "Select an activation id" : "Scan the bucket first"} />
          </SelectTrigger>
          <SelectContent>
            {activations.map((a) => (
              <SelectItem key={a.activation_id} value={a.activation_id}>
                {a.activation_id === "unassigned" ? "Unassigned files" : `Activation ${a.activation_id}`}
                {" · "}
                {a.files.length} file{a.files.length === 1 ? "" : "s"}
                {a.empty_files ? ` · ${a.empty_files} empty` : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Button onClick={run} disabled={!activation || running || inferenceBlocked}>
          {running ? (
            <Loader2 className="mr-1 h-4 w-4 animate-spin" />
          ) : (
            <Play className="mr-1 h-4 w-4" />
          )}
          Run semantic processing
        </Button>

        {!!Object.keys(results).length && !running && (
          <Button variant="ghost" size="sm" onClick={() => setResults({})}>
            <RefreshCw className="mr-1 h-4 w-4" />
            Clear
          </Button>
        )}
      </div>

      <div className="mt-3">
        <InferenceConfigGuard
          readiness={readiness}
          loading={inferenceLoading}
          error={inferenceError}
          onRecheck={recheck}
        />
      </div>

      <ol className="mt-5 space-y-3">
        {STAGES.map(([key, label], i) => {
          const res = results[key];
          const state = res?.state ?? "idle";
          const tone =
            state === "ok"
              ? "border-primary/40 bg-primary/5"
              : state === "warn"
                ? "border-amber-500/40 bg-amber-500/5"
                : state === "error"
                  ? "border-destructive/40 bg-destructive/5"
                  : "border-border bg-muted/20";
          return (
            <li key={key} className={`rounded-lg border p-3 ${tone}`}>
              <div className="flex items-center gap-2">
                <StageIcon state={state} />
                <span className="text-sm font-medium">
                  {i + 1}. {label}
                </span>
                <span className="ml-auto text-xs text-muted-foreground">
                  {res?.summary ?? "not started"}
                </span>
              </div>

              {!!res?.outputs?.length && (
                <div className="mt-2 grid gap-1 sm:grid-cols-2">
                  {res.outputs.map(([k, v]) => (
                    <div
                      key={`${k}-${v}`}
                      className="flex items-baseline justify-between gap-2 rounded border border-border/60 bg-background/60 px-2 py-1"
                    >
                      <span className="truncate text-[11px] text-muted-foreground" title={k}>
                        {k}
                      </span>
                      <span className="whitespace-nowrap text-[11px] font-medium">{v}</span>
                    </div>
                  ))}
                </div>
              )}

              {!!res?.notes?.length && (
                <ul className="mt-2 space-y-1">
                  {res.notes.map((n) => (
                    <li key={n} className="text-[11px] text-muted-foreground break-all">
                      • {n}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ol>
    </Card>
  );
};

export default PostIngestionWizard;
