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
import { symbolTypeFromCode } from "../_shared/resolverQueue.ts";

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
): Promise<{ nodeId: string | null; usd: number; escalated: boolean; confidence: number }> {
  const candidates = await candidatesFor(admin, row.symbol);
  let res = await resolveSymbol({
    model,
    symbol: row.symbol,
    symbolType: row.symbol_type,
    context: row.context ?? {},
    candidates,
  });
  let usd = res.usd;
  let escalated = false;

  if (res.confidence < minConfidence && escalateModel && escalateModel !== model) {
    escalated = true;
    const retry = await resolveSymbol({
      model: escalateModel,
      symbol: row.symbol,
      symbolType: row.symbol_type,
      context: row.context ?? {},
      candidates,
    });
    usd += retry.usd;
    if (retry.confidence >= res.confidence) res = retry;
  }

  if (res.confidence < minConfidence) {
    return { nodeId: null, usd, escalated, confidence: res.confidence };
  }
  const nodeId = await writeNode(admin, row.symbol, row.symbol_type, { ...res, usd });
  return { nodeId, usd, escalated, confidence: res.confidence };
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
      const r = await resolveOne(admin, row, model, escalateModel, minConfidence);
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
