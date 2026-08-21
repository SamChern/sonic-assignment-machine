// Ingestion compatibility test harness.
//
// Runs a standardized battery of read-only checks against the configured object
// store (S3 via the connector gateway, or the enterprise backend placeholder)
// and any alternate feed prefixes (Intuizi console deliveries), then reports
// schema/metadata mismatches with concrete remediation steps.
//
// Admin JWT or internal service-role only. Never mutates state.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { requireAdmin, AuthzError } from "../_shared/admin.ts";
import {
  activationIdFromKey,
  fetchObjectRows,
  identifierOf,
  INGEST_PREFIXES,
  isRosterRow,
  isSummaryRow,
  normalizeRow,
  partitionDateFromKey,
  REPORT_TYPES,
  type ReportType,
  reportTypeFromKey,
} from "../_shared/intuizi.ts";
import {
  clearS3Cache,
  listObjects,
  s3BackendInfo,
  s3Configured,
  signReadUrl,
  type S3Object,
} from "../_shared/s3.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type Status = "pass" | "warn" | "fail" | "skip";

/** Per-source scopes so a single feed can be retested without a full sweep. */
type Scope = "all" | "object_store" | "intuizi" | "ec2_analysis" | "librosa_rest";

const SCOPES: Scope[] = ["all", "object_store", "intuizi", "ec2_analysis", "librosa_rest"];

interface Check {
  id: string;
  feed: string;
  title: string;
  status: Status;
  detail: string;
  expected?: string;
  actual?: string;
  remediation?: string;
  evidence?: Record<string, unknown>;
  debug?: Record<string, unknown>;
}

const SUPPORTED_EXT = [".parquet", ".pq", ".csv", ".csv.gz", ".json", ".json.gz", ".jsonl", ".ndjson"];

/** Columns the normalizer reads per report type (first alias of each group). */
const EXPECTED_FIELDS: Record<ReportType, string[]> = {
  ctv: ["contentgenre | content_genre | genre", "contenttype | content_type", "channelname | channel_name | network", "iab_cats | iab_categories"],
  apps: ["CategoryName | category_name | category", "TaxonomyName | taxonomy_name | taxonomy", "Signals | signal_count"],
  visitation: ["brandName | brand_name | brand", "d_utc | timestamp | visit_time", "distance | dist_m"],
  demographics: ["age_range | age_band | age", "income_range | income_band", "household_composition | household"],
  origin: ["origin_type | location_type | place_type", "state | region | dma | metro | city", "travel_type | distance_band"],
};

const IDENTIFIER_ALIASES =
  "primary_identifier, eid, maid, madid, idfa, aaid, gaid, hem, hashed_email, device_id, email1";

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function errMsg(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (e && typeof e === "object") return JSON.stringify(e).slice(0, 400);
  return String(e);
}

function ext(key: string): string {
  const lower = key.toLowerCase();
  const hit = SUPPORTED_EXT.find((e) => lower.endsWith(e));
  return hit ?? (lower.match(/\.[a-z0-9.]+$/)?.[0] ?? "(none)");
}

function isSupported(key: string): boolean {
  const lower = key.toLowerCase();
  return SUPPORTED_EXT.some((e) => lower.endsWith(e));
}

function columnsOf(rows: Record<string, unknown>[]): string[] {
  const set = new Set<string>();
  for (const r of rows.slice(0, 50)) for (const k of Object.keys(r)) set.add(k);
  return [...set];
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(SUPABASE_URL, SERVICE_KEY);

  const authz = await requireAdmin(req, admin).catch((e) => e as AuthzError);
  if (authz instanceof AuthzError) return json({ error: authz.message }, authz.status);

  const body = await req.json().catch(() => ({})) as {
    maxObjects?: number;
    maxRowsPerObject?: number;
    prefixes?: string[];
    key?: string;
    scope?: string;
    debug?: boolean;
  };
  const maxObjects = Math.max(1, Math.min(8, Number(body.maxObjects ?? 3)));
  const maxRows = Math.max(20, Math.min(2000, Number(body.maxRowsPerObject ?? 300)));
  const scope: Scope = SCOPES.includes(body.scope as Scope) ? (body.scope as Scope) : "all";
  const debug = body.debug === true;

  const wants = (s: Exclude<Scope, "all">) => scope === "all" || scope === s;
  /** Object-store reads back both the store scope and the intuizi contract scope. */
  const wantsStoreReads = wants("object_store") || wants("intuizi");

  const startedAt = Date.now();
  const checks: Check[] = [];
  const trace: { at: number; step: string; detail?: unknown }[] = [];
  const log = (step: string, detail?: unknown) => {
    if (debug) trace.push({ at: Date.now() - startedAt, step, detail });
  };
  const add = (c: Check) => {
    if (!debug && c.debug) delete c.debug;
    checks.push(c);
  };
  log("start", { scope, maxObjects, maxRows });

  const finish = (extra: Record<string, unknown> = {}) =>
    json({
      ran_at: new Date().toISOString(),
      duration_ms: Date.now() - startedAt,
      scope,
      debug,
      summary: summarize(checks),
      checks,
      objects_sampled: [],
      ...extra,
      ...(debug ? { trace } : {}),
    });

  // ---------------------------------------------------------------- 1. config
  const backend = s3BackendInfo();
  if (wantsStoreReads) {
    add({
      id: "config.object_store",
      feed: "object store",
      title: "Object store backend configured",
      status: backend.configured ? (backend.placeholder ? "warn" : "pass") : "fail",
      detail: backend.placeholder
        ? `Active backend "${backend.backend}" is a placeholder implementation.`
        : `Active backend: ${backend.backend}.`,
      expected: "a configured, implemented backend driver",
      actual: `${backend.backend} (configured=${backend.configured})`,
      remediation: backend.configured
        ? (backend.placeholder
          ? "Unset S3_BACKEND to use the connector gateway, or implement the enterprise driver in supabase/functions/_shared/s3.ts."
          : undefined)
        : "Link the Amazon S3 connection to this project (or set S3_ENTERPRISE_BASE_URL / S3_ENTERPRISE_API_KEY for the enterprise backend), then re-run these tests.",
      debug: {
        backend,
        env_present: {
          LOVABLE_API_KEY: !!Deno.env.get("LOVABLE_API_KEY"),
          AWS_S3_API_KEY: !!Deno.env.get("AWS_S3_API_KEY"),
          S3_BACKEND: Deno.env.get("S3_BACKEND") ?? null,
          S3_ENTERPRISE_BASE_URL: !!Deno.env.get("S3_ENTERPRISE_BASE_URL"),
        },
      },
    });

    add({
      id: "config.gateway_keys",
      feed: "object store",
      title: "Gateway credentials present",
      status: backend.backend !== "connector_gateway"
        ? "skip"
        : (Deno.env.get("LOVABLE_API_KEY") && Deno.env.get("AWS_S3_API_KEY") ? "pass" : "fail"),
      detail: backend.backend !== "connector_gateway"
        ? "Not applicable for the current backend."
        : "LOVABLE_API_KEY + AWS_S3_API_KEY are required for listing and signed reads.",
      remediation:
        "Link the Amazon S3 connection so AWS_S3_API_KEY is injected; LOVABLE_API_KEY is provided by the platform.",
    });
  }

  const altFeeds: {
    id: Exclude<Scope, "all">;
    label: string;
    env: string[];
    urlEnv: string;
    healthPath: string;
    authEnv?: string;
  }[] = [
    {
      id: "ec2_analysis",
      label: "EC2 analysis API",
      env: ["AWS_API_URL", "AWS_API_KEY"],
      urlEnv: "AWS_API_URL",
      healthPath: "/health",
      authEnv: "AWS_API_KEY",
    },
    {
      id: "librosa_rest",
      label: "Librosa REST",
      env: ["LIBROSA_REST_URL"],
      urlEnv: "LIBROSA_REST_URL",
      healthPath: "/health",
      authEnv: "LIBROSA_REST_TOKEN",
    },
  ];
  for (const f of altFeeds) {
    if (!wants(f.id)) continue;
    const missing = f.env.filter((k) => !Deno.env.get(k));
    add({
      id: `config.${f.id}`,
      feed: f.label,
      title: `${f.label} credentials`,
      status: missing.length === 0 ? "pass" : (missing.length === f.env.length ? "skip" : "warn"),
      detail: missing.length === 0
        ? "All required settings present."
        : `Missing: ${missing.join(", ")}.`,
      remediation: missing.length
        ? `Add ${missing.join(" and ")} in the backend secrets if this feed should be active.`
        : undefined,
      debug: { required: f.env, missing },
    });

    // Live reachability probe — only when the feed is explicitly in scope.
    const base = Deno.env.get(f.urlEnv);
    if (!base) continue;
    const target = `${base.replace(/\/+$/, "")}${f.healthPath}`;
    const t0 = Date.now();
    try {
      const token = f.authEnv ? Deno.env.get(f.authEnv) : undefined;
      const res = await fetch(target, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        signal: AbortSignal.timeout(8000),
      });
      const text = (await res.text()).slice(0, 400);
      log(`probe.${f.id}`, { status: res.status, ms: Date.now() - t0 });
      add({
        id: `reach.${f.id}`,
        feed: f.label,
        title: `${f.label} reachable`,
        status: res.ok ? "pass" : "fail",
        detail: res.ok
          ? `Health endpoint answered ${res.status} in ${Date.now() - t0}ms.`
          : `Health endpoint answered ${res.status}.`,
        expected: "HTTP 200 from the feed health endpoint",
        actual: `HTTP ${res.status}`,
        remediation: res.ok
          ? undefined
          : res.status === 401 || res.status === 403
          ? `Credentials rejected. Rotate ${f.authEnv ?? "the feed token"} and confirm the service expects a bearer token.`
          : "Confirm the service is running behind its reverse proxy and the URL points at the health route.",
        debug: { url: target, status: res.status, latency_ms: Date.now() - t0, body: text },
      });
    } catch (e) {
      const msg = errMsg(e);
      log(`probe.${f.id}.error`, msg);
      add({
        id: `reach.${f.id}`,
        feed: f.label,
        title: `${f.label} reachable`,
        status: "fail",
        detail: msg,
        expected: "HTTP 200 from the feed health endpoint",
        actual: msg,
        remediation: /timed out|timeout|abort/i.test(msg)
          ? "The host did not answer within 8s — check the security group, Nginx upstream and the service unit."
          : "Verify the configured URL is publicly resolvable from the backend runtime.",
        debug: { url: target, latency_ms: Date.now() - t0 },
      });
    }
  }

  if (!wantsStoreReads) return finish({ backend });

  if (!s3Configured()) return finish();


  // ----------------------------------------------------- 2. prefix reachability
  clearS3Cache();
  const prefixes = (body.prefixes?.length ? body.prefixes : INGEST_PREFIXES.map((p) => p.prefix));
  const discovered: S3Object[] = [];
  let anyPrefixOk = false;

  for (const prefix of prefixes) {
    const t0 = Date.now();
    try {
      const objects = await listObjects(prefix, 50);
      anyPrefixOk = true;
      discovered.push(...objects);
      log(`list.${prefix}`, { count: objects.length, ms: Date.now() - t0 });
      add({
        id: `list.${prefix}`,
        feed: "object store",
        title: `Prefix reachable: ${prefix}`,
        status: objects.length ? "pass" : "warn",
        detail: objects.length
          ? `${objects.length} object(s) listed.`
          : "Prefix is reachable but empty.",
        remediation: objects.length
          ? undefined
          : `No deliveries under ${prefix}. Confirm the feed writes to this prefix (or remove it from INGEST_PREFIXES).`,
        evidence: { sample: objects.slice(0, 3).map((o) => o.key) },
        debug: {
          latency_ms: Date.now() - t0,
          all_keys: objects.map((o) => o.key),
          sizes: objects.slice(0, 10).map((o) => ({ key: o.key, size: o.size, last_modified: o.lastModified })),
        },
      });
    } catch (e) {
      const msg = errMsg(e);
      log(`list.${prefix}.error`, msg);
      add({
        id: `list.${prefix}`,
        feed: "object store",
        title: `Prefix reachable: ${prefix}`,
        status: "fail",
        detail: msg,
        expected: "HTTP 200 from ListObjectsV2",
        actual: msg,
        remediation: /403|AccessDenied/i.test(msg)
          ? "The IAM key behind the connection lacks s3:ListBucket on this prefix. Grant read access to the bucket/prefix and reconnect."
          : /404|NoSuchBucket/i.test(msg)
          ? "Bucket or prefix does not exist. Verify the bucket name and path prefix on the connection."
          : "Re-check the object store connection, then re-run. If the error persists, the gateway response body above is the provider's own error.",
        debug: { latency_ms: Date.now() - t0, prefix, raw_error: msg },
      });
    }
  }


  if (!anyPrefixOk) {
    return json({
      ran_at: new Date().toISOString(),
      duration_ms: Date.now() - startedAt,
      summary: summarize(checks),
      checks,
      objects_sampled: [],
    });
  }

  // ------------------------------------------------------ 3. metadata contracts
  const unsupported = discovered.filter((o) => !isSupported(o.key));
  add({
    id: "meta.file_format",
    feed: "intuizi",
    title: "File formats are readable",
    status: unsupported.length === 0 ? "pass" : "warn",
    detail: unsupported.length === 0
      ? `All ${discovered.length} discovered object(s) use a supported format.`
      : `${unsupported.length} object(s) use an unreadable format.`,
    expected: SUPPORTED_EXT.join(", "),
    actual: unsupported.length ? [...new Set(unsupported.map((o) => ext(o.key)))].join(", ") : "supported",
    remediation: unsupported.length
      ? "Ask the feed provider to deliver Parquet, CSV(.gz), JSON or JSONL. Non-tabular artifacts (pcap, logs, archives) are ignored by the ingest."
      : undefined,
    evidence: { keys: unsupported.slice(0, 5).map((o) => o.key) },
  });

  const readable = discovered.filter((o) => isSupported(o.key) && o.size > 0);
  const emptyObjects = discovered.filter((o) => isSupported(o.key) && o.size === 0);
  if (emptyObjects.length) {
    add({
      id: "meta.zero_bytes",
      feed: "intuizi",
      title: "Zero-byte deliveries",
      status: "warn",
      detail: `${emptyObjects.length} object(s) are 0 bytes.`,
      remediation: "Re-request the delivery — the export completed without data.",
      evidence: { keys: emptyObjects.slice(0, 5).map((o) => o.key) },
    });
  }

  const untyped = readable.filter((o) => !reportTypeFromKey(o.key));
  add({
    id: "meta.report_type",
    feed: "intuizi",
    title: "Report type resolvable from key",
    status: untyped.length === 0 ? "pass" : "fail",
    detail: untyped.length === 0
      ? "Every readable object maps to a report type."
      : `${untyped.length} object(s) cannot be classified, so they are skipped by the ingest.`,
    expected: `a directory prefix (${REPORT_TYPES.join("/")}) or a filename token`,
    actual: untyped.length ? "no matching prefix or token" : "resolvable",
    remediation: untyped.length
      ? "Rename the delivery so the filename contains a report token (ctv, apps, visitation, demographics, origin) or land it under the matching prefix directory."
      : undefined,
    evidence: { keys: untyped.slice(0, 5).map((o) => o.key) },
  });

  const activations = readable.filter((o) => o.key.startsWith("Activations/") || /activation/i.test(o.key));
  const missingActivationId = activations.filter((o) => !activationIdFromKey(o.key));
  add({
    id: "meta.activation_id",
    feed: "intuizi",
    title: "Activation id encoded in filename",
    status: activations.length === 0 ? "skip" : (missingActivationId.length ? "warn" : "pass"),
    detail: activations.length === 0
      ? "No activation-style deliveries discovered."
      : missingActivationId.length
      ? `${missingActivationId.length} activation file(s) have no parseable id.`
      : `${activations.length} activation file(s) carry an id.`,
    expected: "…_activation_id<NNNN>_…",
    remediation: missingActivationId.length
      ? "Ask Intuizi to keep the `activation_id<NNNN>` token in export filenames — summary rollups are keyed on it."
      : undefined,
    evidence: { keys: missingActivationId.slice(0, 5).map((o) => o.key) },
  });

  const noPartition = readable.filter((o) => !partitionDateFromKey(o.key));
  if (readable.length) {
    add({
      id: "meta.partition_date",
      feed: "intuizi",
      title: "Delivery date present in key",
      status: noPartition.length === 0 ? "pass" : "warn",
      detail: noPartition.length === 0
        ? "All readable objects expose a date."
        : `${noPartition.length} object(s) have no dt=YYYY-MM-DD or YYYYMMDD-style date.`,
      remediation: noPartition.length
        ? "Add a `dt=YYYY-MM-DD` partition folder or a date token in the filename so freshness and backfills can be reasoned about."
        : undefined,
      evidence: { keys: noPartition.slice(0, 5).map((o) => o.key) },
    });
  }

  // ---------------------------------------------------------- 4. schema probes
  const candidates = readable
    .filter((o) => reportTypeFromKey(o.key))
    .sort((a, b) => (b.lastModified ?? "").localeCompare(a.lastModified ?? ""))
    .slice(0, maxObjects);

  const sampled: Record<string, unknown>[] = [];
  const targets = body.key
    ? readable.filter((o) => o.key === body.key)
    : candidates;

  if (!targets.length) {
    add({
      id: "schema.no_candidates",
      feed: "intuizi",
      title: "Schema probe",
      status: "skip",
      detail: "No readable, classifiable objects available to probe.",
      remediation: "Resolve the metadata findings above, then re-run the compatibility tests.",
    });
  }

  for (const obj of targets) {
    const reportType = reportTypeFromKey(obj.key)!;
    try {
      const url = await signReadUrl(obj.key);
      const rows = await fetchObjectRows(url, obj.key, maxRows);
      const cols = columnsOf(rows);
      const withId = rows.filter((r) => identifierOf(r)).length;
      const summaryRows = rows.filter((r) => isSummaryRow(r)).length;
      const rosterRows = rows.filter((r) => isRosterRow(r)).length;
      const normalized = rows.map((r) => normalizeRow(reportType, r)).filter(Boolean);
      const tagRate = rows.length ? normalized.length / rows.length : 0;

      sampled.push({
        key: obj.key,
        report_type: reportType,
        size: obj.size,
        last_modified: obj.lastModified,
        rows_read: rows.length,
        columns: cols,
        rows_with_identifier: withId,
        summary_rows: summaryRows,
        roster_rows: rosterRows,
        normalized_rows: normalized.length,
      });

      if (rows.length === 0) {
        add({
          id: `schema.empty.${obj.key}`,
          feed: "intuizi",
          title: `Rows present — ${obj.key.split("/").pop()}`,
          status: "fail",
          detail: "File parsed but contains 0 data rows (headers/footer only).",
          expected: "≥1 data row",
          actual: "0 rows",
          remediation: "Re-request this delivery: the export wrote a schema with no records, so nothing can be scored.",
        });
        continue;
      }

      // identifier / summary shape
      const shapeOk = withId > 0 || summaryRows > 0;
      add({
        id: `schema.identifier.${obj.key}`,
        feed: "intuizi",
        title: `Join key or summary shape — ${obj.key.split("/").pop()}`,
        status: shapeOk ? (withId > 0 ? "pass" : "warn") : "fail",
        detail: withId > 0
          ? `${withId}/${rows.length} rows expose an identifier column.`
          : summaryRows > 0
          ? `No identifier column; treated as an audience-level summary report (${summaryRows} taxonomy rows).`
          : "No identifier column and no taxonomy columns — the ingest cannot key these rows.",
        expected: `one of: ${IDENTIFIER_ALIASES}`,
        actual: cols.join(", ").slice(0, 400),
        remediation: shapeOk
          ? (withId === 0
            ? "Fine for summary rollups, but per-device fingerprints need an identifier column (maid/hem/eid) in the delivery."
            : undefined)
          : `Ask the provider to include an identifier column (${IDENTIFIER_ALIASES}) or taxonomy columns (TaxonomyName/CategoryName).`,
        evidence: { columns: cols },
      });

      // taxonomy / feature columns for the resolved report type
      const expectedFields = EXPECTED_FIELDS[reportType];
      const lowerCols = cols.map((c) => c.toLowerCase());
      const matchedGroups = expectedFields.filter((group) =>
        group.split("|").map((a) => a.trim().toLowerCase()).some((a) => lowerCols.includes(a))
      );
      add({
        id: `schema.fields.${obj.key}`,
        feed: "intuizi",
        title: `Ontology feature columns — ${obj.key.split("/").pop()}`,
        status: matchedGroups.length === expectedFields.length
          ? "pass"
          : matchedGroups.length > 0
          ? "warn"
          : "fail",
        detail: `${matchedGroups.length}/${expectedFields.length} ${reportType} feature groups present.`,
        expected: expectedFields.join("  •  "),
        actual: cols.join(", ").slice(0, 400),
        remediation: matchedGroups.length === expectedFields.length
          ? undefined
          : `Missing: ${
            expectedFields.filter((g) => !matchedGroups.includes(g)).join("  •  ")
          }. Either request these columns from the feed, or extend normalizeRow() in _shared/intuizi.ts with the provider's actual column aliases.`,
        evidence: { columns: cols },
      });

      // normalization yield
      add({
        id: `schema.yield.${obj.key}`,
        feed: "intuizi",
        title: `Normalization yield — ${obj.key.split("/").pop()}`,
        status: tagRate >= 0.5 ? "pass" : tagRate > 0 ? "warn" : (summaryRows > 0 ? "warn" : "fail"),
        detail: `${normalized.length}/${rows.length} sampled rows produced ontology tags (${
          Math.round(tagRate * 100)
        }%). Roster-only rows: ${rosterRows}.`,
        expected: "≥50% of rows yield at least one tag",
        actual: `${Math.round(tagRate * 100)}%`,
        remediation: tagRate >= 0.5
          ? undefined
          : rosterRows > 0
          ? "This delivery is mostly a device roster (join keys only). Pair it with the matching taxonomy/summary export so the identifiers acquire signal."
          : "Column values are present but unmapped. Compare the observed columns above with the expected aliases and extend the field mapping.",
      });
    } catch (e) {
      const msg = errMsg(e);
      add({
        id: `schema.read.${obj.key}`,
        feed: "intuizi",
        title: `Readable — ${obj.key.split("/").pop()}`,
        status: "fail",
        detail: msg,
        expected: "object decodes to tabular rows",
        actual: msg,
        remediation: /codec|compress|snappy|zstd/i.test(msg)
          ? "Unsupported Parquet codec. Request snappy/gzip/zstd output, or add the codec to _shared/parquet.ts."
          : /403|AccessDenied|sign/i.test(msg)
          ? "Signed read was refused: the connection's IAM key needs s3:GetObject on this prefix."
          : /JSON|Unexpected token|parse/i.test(msg)
          ? "The file extension does not match its contents. Confirm the provider's export format for this prefix."
          : "Inspect the raw error above; it is the provider/parser message verbatim.",
      });
    }
  }

  return json({
    ran_at: new Date().toISOString(),
    duration_ms: Date.now() - startedAt,
    backend,
    discovered_objects: discovered.length,
    summary: summarize(checks),
    checks,
    objects_sampled: sampled,
  });
});

function summarize(checks: Check[]) {
  const counts: Record<Status, number> = { pass: 0, warn: 0, fail: 0, skip: 0 };
  for (const c of checks) counts[c.status]++;
  return {
    ...counts,
    total: checks.length,
    verdict: counts.fail > 0 ? "incompatible" : counts.warn > 0 ? "degraded" : "compatible",
  };
}
