// Step 13 — The Resolver.
//
// Drains public.resolution_queue: symbols the ontology met but does not know.
// For each one, the agent reads open-web metadata, writes what the symbol MEANS
// in sonic-semantic terms, embeds that description, and inserts an unreviewed
// taxonomy node with crosswalk proposals for admin approval. Never inline with
// ingest — this runs on the nightly schedule after ingest, or interactively for
// one symbol from the Control Room.
//
// Body:
//   { action: "run", limit? }             — nightly drain (service role or admin)
//   { action: "resolve_one", symbol, symbol_type?, context? }
//   { action: "status" }                  — queue depth, today's spend, pause state
//   { action: "review", node_id, decision: "approve" | "reject" }
//   { action: "nudge", refresh? }         — signal-health thresholds; refresh fires the agent
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { AuthzError, requireAdmin } from "../_shared/admin.ts";
import { controlBoolean, controlNumber, controlString } from "../_shared/control.ts";
import { embed } from "../_shared/ontology.ts";
import { isSensitiveTag } from "../_shared/sensitiveTaxonomy.ts";
import {
  ResolverGatewayError,
  resolveSymbol,
  type Resolution,
} from "../_shared/resolverAgent.ts";
import { enqueueUnknownSymbol, symbolTypeFromCode } from "../_shared/resolverQueue.ts";
import { buildNudgeReport } from "../_shared/resolverNudge.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const LEASE_ID = "signal-resolver";
const LEASE_SECONDS = 600;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// deno-lint-ignore no-explicit-any
type Client = any;

interface QueueRow {
  id: string;
  symbol: string;
  symbol_type: string;
  context: Record<string, unknown> | null;
  attempts: number;
}

/** Estimated agent spend booked today, read back off the nodes it wrote. */
async function spendToday(admin: Client): Promise<number> {
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const { data } = await admin
    .from("taxonomy_nodes")
    .select("proposal")
    .eq("source", "agent")
    .gte("created_at", since)
    .limit(2000);
  let usd = 0;
  for (const row of (data ?? []) as { proposal: { usd?: number } | null }[]) {
    usd += Number(row.proposal?.usd ?? 0);
  }
  return usd;
}

async function pause(admin: Client, reason: string) {
  await admin
    .from("job_worker_state")
    .update({
      paused: true,
      pause_reason: reason,
      paused_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", LEASE_ID);
}

async function readState(admin: Client) {
  const { data } = await admin
    .from("job_worker_state")
    .select("paused, pause_reason, paused_at, last_error, last_kick_at")
    .eq("id", LEASE_ID)
    .maybeSingle();
  return (data ?? { paused: false }) as {
    paused: boolean;
    pause_reason?: string | null;
    paused_at?: string | null;
    last_error?: string | null;
    last_kick_at?: string | null;
  };
}

/** Existing codes offered to the model as crosswalk candidates. */
async function candidatesFor(admin: Client, symbol: string) {
  const prefix = symbol.split(".").slice(0, 2).join(".");
  const { data } = await admin
    .from("taxonomy_nodes")
    .select("code, label")
    .eq("reviewed", true)
    .ilike("code", `${prefix}%`)
    .limit(24);
  const rows = (data ?? []) as { code: string; label: string }[];
  if (rows.length >= 6) return rows;
  const { data: audioset } = await admin
    .from("taxonomy_nodes")
    .select("code, label")
    .ilike("code", "audioset.%")
    .limit(24 - rows.length);
  return [...rows, ...((audioset ?? []) as { code: string; label: string }[])];
}

/**
 * Step trace: every resolver run records what it did, in order, so the admin
 * can read a symbol's score back to the steps that produced it.
 */
interface StepLogger {
  runId: string;
  log: (
    step: string,
    status: string,
    detail?: Record<string, unknown>,
    startedAt?: number,
  ) => Promise<void>;
}

function stepLogger(admin: Client, queueId: string | null, symbol: string): StepLogger {
  const runId = crypto.randomUUID();
  return {
    runId,
    log: async (step, status, detail = {}, startedAt) => {
      const { error } = await admin.from("resolver_steps").insert({
        run_id: runId,
        queue_id: queueId,
        symbol,
        step,
        status,
        detail,
        duration_ms: startedAt ? Math.round(performance.now() - startedAt) : null,
      });
      if (error) console.error("step log failed", step, error.message);
    },
  };
}


/**
 * Persist one resolution as an unreviewed agent node with crosswalk proposals
 * in the shape the Step 5 review flow already reads.
 */
async function writeNode(
  admin: Client,
  symbol: string,
  symbolType: string,
  res: Resolution,
): Promise<string | null> {
  const label = symbol.split(".").pop() ?? symbol;
  const suppressed = isSensitiveTag(symbol, label);
  const embedding = suppressed ? null : await embed(`${symbol} :: ${label}. ${res.description}`);

  const matches = res.anchors.map((a) => ({
    code: a.code,
    label: a.label,
    similarity: a.confidence,
    via: "agent",
    approved: false,
  }));

  const payload = {
    code: symbol,
    label,
    parent_code: symbol.includes(".") ? symbol.split(".").slice(0, -1).join(".") : null,
    embedding,
    suppressed,
    source: "agent",
    reviewed: false,
    crosswalk: { matches },
    proposal: {
      description: res.description,
      tendencies: res.tendencies,
      anchors: res.anchors,
      confidence: res.confidence,
      model: res.model,
      usd: res.usd,
      symbol_type: symbolType,
      sources: res.snippets.map((s) => ({ source: s.source, title: s.title, url: s.url })),
      resolved_at: new Date().toISOString(),
    },
  };

  const { data: existing } = await admin
    .from("taxonomy_nodes").select("id").eq("code", symbol).maybeSingle();
  if (existing) {
    await admin
      .from("taxonomy_nodes")
      .update({
        crosswalk: payload.crosswalk,
        proposal: payload.proposal,
        source: "agent",
        reviewed: false,
        label,
        embedding: embedding ?? undefined,
        updated_at: new Date().toISOString(),
      })
      .eq("id", existing.id);
    return existing.id as string;
  }

  const { data: inserted, error } = await admin
    .from("taxonomy_nodes").insert(payload).select("id").single();
  if (error) {
    console.error("agent node insert failed", symbol, error);
    return null;
  }
  return inserted.id as string;
}

interface RunOutcome {
  resolved: number;
  failed: number;
  escalated: number;
  halted: string | null;
  usd: number;
  remaining: number;
}

async function resolveOne(
  admin: Client,
  row: QueueRow,
  model: string,
  escalateModel: string,
  minConfidence: number,
  trace?: StepLogger,
): Promise<{
  nodeId: string | null;
  usd: number;
  escalated: boolean;
  confidence: number;
  runId?: string;
}> {
  const t0 = performance.now();
  const candidates = await candidatesFor(admin, row.symbol);
  await trace?.log("candidates", "ok", {
    count: candidates.length,
    codes: candidates.slice(0, 8).map((c) => c.code),
  }, t0);

  const t1 = performance.now();
  let res = await resolveSymbol({
    model,
    symbol: row.symbol,
    symbolType: row.symbol_type,
    context: row.context ?? {},
    candidates,
  });
  let usd = res.usd;
  let escalated = false;
  await trace?.log("model", "ok", {
    model,
    confidence: res.confidence,
    usd: res.usd,
    description: res.description,
    tendencies: res.tendencies,
    anchors: res.anchors,
    sources: res.snippets.map((s) => ({ source: s.source, title: s.title, url: s.url })),
  }, t1);

  if (res.confidence < minConfidence && escalateModel && escalateModel !== model) {
    escalated = true;
    const t2 = performance.now();
    const retry = await resolveSymbol({
      model: escalateModel,
      symbol: row.symbol,
      symbolType: row.symbol_type,
      context: row.context ?? {},
      candidates,
    });
    usd += retry.usd;
    const kept = retry.confidence >= res.confidence;
    if (kept) res = retry;
    await trace?.log("escalate", "ok", {
      model: escalateModel,
      confidence: retry.confidence,
      kept,
      usd: retry.usd,
    }, t2);
  }

  if (res.confidence < minConfidence) {
    await trace?.log("threshold", "failed", {
      confidence: res.confidence,
      min_confidence: minConfidence,
    });
    return { nodeId: null, usd, escalated, confidence: res.confidence, runId: trace?.runId };
  }
  const t3 = performance.now();
  const nodeId = await writeNode(admin, row.symbol, row.symbol_type, { ...res, usd });
  await trace?.log("write_node", nodeId ? "ok" : "failed", {
    node_id: nodeId,
    confidence: res.confidence,
    usd,
  }, t3);
  return { nodeId, usd, escalated, confidence: res.confidence, runId: trace?.runId };
}

async function drain(admin: Client, limitOverride?: number): Promise<RunOutcome> {
  const enabled = await controlBoolean(admin, "resolver.enabled", true);
  if (!enabled) {
    return { resolved: 0, failed: 0, escalated: 0, halted: "disabled", usd: 0, remaining: 0 };
  }

  const state = await readState(admin);
  const model = await controlString(admin, "resolver.model", "openai/gpt-5.6-sol");
  const escalateModel = await controlString(
    admin, "resolver.escalate_model", "openai/gpt-5.6-sol",
  );
  const batchMax = await controlNumber(admin, "resolver.batch_max", 40, { min: 1, max: 500 });
  const budget = await controlNumber(admin, "resolver.daily_budget", 2.5, { min: 0, max: 100 });
  const minConfidence = await controlNumber(
    admin, "resolver.min_confidence", 0.45, { min: 0, max: 1 },
  );

  // Paused-state guard: while parked on credits or policy, process at most one
  // probe row per run to detect out-of-band recovery.
  const limit = state.paused ? 1 : Math.min(batchMax, limitOverride ?? batchMax);

  const { data: rows } = await admin
    .from("resolution_queue")
    .select("id, symbol, symbol_type, context, attempts")
    .eq("status", "pending")
    .lt("attempts", 4)
    .order("first_seen_at", { ascending: true })
    .limit(limit);

  const queue = (rows ?? []) as QueueRow[];
  let spent = await spendToday(admin);
  const out: RunOutcome = {
    resolved: 0, failed: 0, escalated: 0, halted: null, usd: 0, remaining: 0,
  };
  let rateLimits = 0;

  for (const row of queue) {
    if (spent + out.usd >= budget) {
      out.halted = `daily_budget reached ($${budget.toFixed(2)})`;
      break;
    }
    await admin
      .from("resolution_queue")
      .update({ status: "resolving", attempts: row.attempts + 1 })
      .eq("id", row.id);

    try {
      const r = await resolveOne(
        admin,
        row,
        model,
        escalateModel,
        minConfidence,
        stepLogger(admin, row.id, row.symbol),
      );
      out.usd += r.usd;
      if (r.escalated) out.escalated++;
      if (r.nodeId) {
        out.resolved++;
        await admin
          .from("resolution_queue")
          .update({ status: "resolved", resolved_node_id: r.nodeId, last_error: null })
          .eq("id", row.id);
      } else {
        out.failed++;
        await admin
          .from("resolution_queue")
          .update({
            status: row.attempts + 1 >= 4 ? "failed" : "pending",
            last_error: `low confidence (${r.confidence.toFixed(2)} < ${minConfidence})`,
          })
          .eq("id", row.id);
      }
      // A successful call clears an earlier credit/policy pause.
      if (state.paused && r.nodeId) {
        await admin
          .from("job_worker_state")
          .update({ paused: false, pause_reason: null, updated_at: new Date().toISOString() })
          .eq("id", LEASE_ID);
        state.paused = false;
      }
    } catch (e) {
      const err = e as ResolverGatewayError;
      const status = err.status ?? 0;
      out.failed++;
      await admin
        .from("resolution_queue")
        .update({ status: "pending", last_error: String(err.message).slice(0, 500) })
        .eq("id", row.id);

      if (status === 402 || status === 403) {
        // Circuit breaker: park the whole job until an owner resumes or a probe
        // succeeds on a later run.
        await pause(admin, `gateway ${status}: ${String(err.message).slice(0, 200)}`);
        out.halted = `gateway ${status}`;
        break;
      }
      if (status === 429) {
        rateLimits++;
        if (rateLimits >= 3) {
          out.halted = "rate limited — parked until the next scheduled run";
          break;
        }
        await new Promise((r) => setTimeout(r, 2000 * rateLimits));
        continue;
      }
      if (status >= 500) {
        out.halted = `upstream ${status} — parked until the next scheduled run`;
        break;
      }
      console.error("resolver terminal error", row.symbol, status, err.message);
    }
  }

  const { count } = await admin
    .from("resolution_queue")
    .select("id", { count: "exact", head: true })
    .eq("status", "pending");
  out.remaining = count ?? 0;

  await admin
    .from("job_worker_state")
    .update({
      last_kick_at: new Date().toISOString(),
      last_error: out.halted,
      updated_at: new Date().toISOString(),
    })
    .eq("id", LEASE_ID);

  console.log("resolver run", JSON.stringify(out));
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const authz = await requireAdmin(req, admin).catch((e) => e as AuthzError);
    if (authz instanceof AuthzError) {
      return json({ success: false, error: authz.message }, authz.status);
    }

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const action = String(body.action ?? "status");

    if (action === "status") {
      const { data: rows } = await admin
        .from("resolution_queue")
        .select("status")
        .limit(5000);
      const counts: Record<string, number> = {};
      for (const r of (rows ?? []) as { status: string }[]) {
        counts[r.status] = (counts[r.status] ?? 0) + 1;
      }
      const { data: proposals } = await admin
        .from("taxonomy_nodes")
        .select("id, code, label, proposal, crosswalk, created_at")
        .eq("source", "agent")
        .eq("reviewed", false)
        .order("created_at", { ascending: false })
        .limit(50);
      const state = await readState(admin);
      return json({
        success: true,
        counts,
        pending: counts.pending ?? 0,
        state,
        spend_today: await spendToday(admin),
        budget: await controlNumber(admin, "resolver.daily_budget", 2.5, { min: 0, max: 100 }),
        enabled: await controlBoolean(admin, "resolver.enabled", true),
        model: await controlString(admin, "resolver.model", "openai/gpt-5.6-sol"),
        proposals: proposals ?? [],
      });
    }

    // Queue view for the admin Resolver page: paged rows with optional status
    // filter and symbol search, plus the resolved node for the detail view.
    if (action === "queue") {
      const status = String(body.status ?? "").trim();
      const search = String(body.search ?? "").trim();
      const limit = Math.min(200, Math.max(1, Number(body.limit ?? 50)));
      const offset = Math.max(0, Number(body.offset ?? 0));
      let q = admin
        .from("resolution_queue")
        .select(
          "id, symbol, symbol_type, status, attempts, sightings, last_error, resolved_node_id, first_seen_at, last_seen_at, context",
          { count: "estimated" },
        )
        .order("sightings", { ascending: false })
        .order("last_seen_at", { ascending: false })
        .range(offset, offset + limit - 1);
      if (status && status !== "all") q = q.eq("status", status);
      if (search) q = q.ilike("symbol", `%${search}%`);
      const { data: rows, count, error } = await q;
      if (error) return json({ success: false, error: error.message }, 500);

      const nodeIds = (rows ?? [])
        .map((r: { resolved_node_id: string | null }) => r.resolved_node_id)
        .filter((v: string | null): v is string => !!v);
      let nodes: Record<string, unknown>[] = [];
      if (nodeIds.length) {
        const { data } = await admin
          .from("taxonomy_nodes")
          .select("id, code, label, reviewed, proposal, crosswalk")
          .in("id", nodeIds);
        nodes = data ?? [];
      }
      return json({ success: true, rows: rows ?? [], total: count ?? null, nodes });
    }

    // Manual enqueue from the admin Tools panel: one or many symbols, idempotent.
    if (action === "enqueue") {
      const raw = Array.isArray(body.symbols)
        ? body.symbols.map((s) => String(s))
        : String(body.symbols ?? body.symbol ?? "").split(/[\n,]/);
      const symbols = [...new Set(raw.map((s) => s.trim()).filter(Boolean))].slice(0, 200);
      if (!symbols.length) return json({ success: false, error: "symbols are required" }, 400);
      let queued = 0;
      for (const symbol of symbols) {
        await enqueueUnknownSymbol(admin, {
          symbol,
          symbol_type: symbolTypeFromCode(symbol),
          context: { queued_by: authz.userId ?? "internal", source: "admin_tools" },
        });
        queued += 1;
      }
      return json({ success: true, queued, symbols });
    }



    if (action === "review") {
      const nodeId = String(body.node_id ?? "");
      const decision = String(body.decision ?? "");
      if (!nodeId || !["approve", "reject"].includes(decision)) {
        return json({ success: false, error: "node_id and decision are required" }, 400);
      }
      const { data: node } = await admin
        .from("taxonomy_nodes").select("id, code, crosswalk").eq("id", nodeId).maybeSingle();
      if (!node) return json({ success: false, error: "node not found" }, 404);

      if (decision === "approve") {
        const cw = (node.crosswalk ?? {}) as { matches?: Record<string, unknown>[] };
        const matches = (cw.matches ?? []).map((m) => ({
          ...m,
          approved: true,
          approved_by: authz.userId,
          approved_at: new Date().toISOString(),
        }));
        await admin
          .from("taxonomy_nodes")
          .update({
            reviewed: true,
            crosswalk: { ...cw, matches },
            updated_at: new Date().toISOString(),
          })
          .eq("id", nodeId);
      } else {
        await admin
          .from("taxonomy_nodes")
          .update({
            reviewed: true,
            suppressed: true,
            updated_at: new Date().toISOString(),
          })
          .eq("id", nodeId);
        await admin
          .from("resolution_queue")
          .update({ status: "skipped", last_error: "rejected by admin" })
          .eq("resolved_node_id", nodeId);
      }
      return json({ success: true, node_id: nodeId, decision });
    }

    if (action === "resolve_one") {
      const symbol = String(body.symbol ?? "").trim();
      if (!symbol) return json({ success: false, error: "symbol is required" }, 400);
      const symbolType = String(body.symbol_type ?? symbolTypeFromCode(symbol));
      const model = await controlString(admin, "resolver.model", "openai/gpt-5.6-sol");
      const escalateModel = await controlString(
        admin, "resolver.escalate_model", "openai/gpt-5.6-sol",
      );
      const minConfidence = await controlNumber(
        admin, "resolver.min_confidence", 0.45, { min: 0, max: 1 },
      );

      // Make sure the symbol is tracked, then resolve it interactively.
      const { data: existing } = await admin
        .from("resolution_queue")
        .select("id, symbol, symbol_type, context, attempts")
        .eq("symbol_type", symbolType)
        .ilike("symbol", symbol)
        .maybeSingle();
      let row = existing as QueueRow | null;
      if (!row) {
        const { data: created } = await admin
          .from("resolution_queue")
          .insert({
            symbol,
            symbol_type: symbolType,
            context: (body.context ?? {}) as Record<string, unknown>,
            status: "resolving",
          })
          .select("id, symbol, symbol_type, context, attempts")
          .single();
        row = created as QueueRow;
      }

      try {
        const r = await resolveOne(admin, row!, model, escalateModel, minConfidence);
        await admin
          .from("resolution_queue")
          .update({
            status: r.nodeId ? "resolved" : "pending",
            resolved_node_id: r.nodeId,
            attempts: (row!.attempts ?? 0) + 1,
            last_error: r.nodeId ? null : `low confidence (${r.confidence.toFixed(2)})`,
          })
          .eq("id", row!.id);
        return json({
          success: true,
          node_id: r.nodeId,
          confidence: r.confidence,
          escalated: r.escalated,
          usd: r.usd,
        });
      } catch (e) {
        const err = e as ResolverGatewayError;
        if (err.status === 402 || err.status === 403) {
          await pause(admin, `gateway ${err.status}: ${String(err.message).slice(0, 200)}`);
        }
        await admin
          .from("resolution_queue")
          .update({ status: "pending", last_error: String(err.message).slice(0, 500) })
          .eq("id", row!.id);
        return json({ success: false, error: err.message }, err.status >= 400 ? err.status : 500);
      }
    }

    if (action === "nudge") {
      let state = await readState(admin);
      let report = await buildNudgeReport(admin, state);
      // `refresh: true` fires the agent right there — the nudge is the trigger,
      // not just a label. Paused (credits/policy) states are never overridden.
      const wantRefresh = body.refresh === true && report.triggered && !state.paused;
      let outcome: RunOutcome | null = null;
      if (wantRefresh) {
        const { data: acquired } = await admin.rpc("acquire_named_lease", {
          p_id: LEASE_ID,
          p_owner: `nudge-${crypto.randomUUID().slice(0, 8)}`,
          p_seconds: LEASE_SECONDS,
        });
        if (acquired !== false) {
          const limit = await controlNumber(
            admin, "resolver.nudge_batch", 10, { min: 1, max: 200 },
          );
          outcome = await drain(admin, limit);
          // Report the state the refresh left behind, not the one that caused it.
          state = await readState(admin);
          report = await buildNudgeReport(admin, state);
        }
      }
      return json({
        success: true,
        ...report,
        state,
        refreshed: outcome !== null,
        outcome,

      });
    }

    if (action === "run") {
      const { data: acquired } = await admin.rpc("acquire_named_lease", {
        p_id: LEASE_ID,
        p_owner: `resolver-${crypto.randomUUID().slice(0, 8)}`,
        p_seconds: LEASE_SECONDS,
      });
      if (acquired === false) {
        return json({ success: true, skipped: "another resolver run holds the lease" });
      }
      const limit = body.limit === undefined ? undefined : Number(body.limit);
      const outcome = await drain(admin, Number.isFinite(limit!) ? limit : undefined);
      return json({ success: true, ...outcome });
    }


    return json({ success: false, error: `unknown action: ${action}` }, 400);
  } catch (e) {
    console.error("signal-resolver failed", e);
    return json({ success: false, error: (e as Error).message }, 500);
  }
});
