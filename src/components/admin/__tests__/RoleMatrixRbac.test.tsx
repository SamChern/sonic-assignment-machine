// Step 9 role matrix, expressed as tests.
//
// Encodes the per-surface access table for every tier: anon, consumer ('user'),
// moderator, enterprise org member (viewer/analyst/owner) and admin.
// Two invariants hold everywhere:
//   1. Anything carrying a `subject_key` (`sonic_cohort_members`) is
//      service-role/admin only — enterprise roles read aggregates.
//   2. The consumer tier has no access to any Intuizi-derived table; its
//      contribution is the labeled-example flywheel via `category_feedback`.
import { describe, expect, it } from "vitest";

type Role = "anon" | "user" | "moderator" | "viewer" | "analyst" | "owner" | "admin";

const ORG = "org1";
const OTHER_ORG = "org2";

const ENTERPRISE: Role[] = ["viewer", "analyst", "owner"];
const isEnterprise = (r: Role) => ENTERPRISE.includes(r);
const signedIn = (r: Role) => r !== "anon";

/** Tables reachable only by admins (or the service role). */
const ADMIN_ONLY_TABLES = new Set([
  "intuizi_ingest_files",
  "intuizi_ingest_state",
  "intuizi_score_queue",
  "job_worker_state",
  "retention_runs",
  "sonic_cohorts",
  "embedding_bridges",
  "control_registry",
  "control_audit",
  "librosa_call_log",
  "semantic_call_log",
  "intuizi_identifiers",
]);

/** Tables with no policies at all: unreachable for every non-service role. */
const NO_POLICY_TABLES = new Set([
  "sonic_cohort_members",
  "embedding_cache",
  "audio_profile_embeddings",
]);

const deny = (role: Role) =>
  role === "anon"
    ? { data: null, error: { message: "401: JWT is required" } }
    : { data: null, error: { message: "403: permission denied" } };

const allow = (rows: Record<string, unknown>[]) => ({ data: rows, error: null });

/**
 * Models the RLS outcome of a read for a given role, mirroring the policies in
 * the database rather than hitting it (keeps this a fast unit suite).
 */
const read = (role: Role, table: string, org: string = ORG) => {
  if (NO_POLICY_TABLES.has(table)) return deny(role);
  if (!signedIn(role)) return deny(role);

  if (role === "admin") return allow([{ id: "row1", organization_id: org }]);

  if (ADMIN_ONLY_TABLES.has(table)) return deny(role);

  // Taxonomy is readable by any signed-in user; writes are admin-only.
  if (table === "taxonomy_nodes") return allow([{ code: "/m/04rlf", label: "Music" }]);

  // Org-scoped tables: enterprise members see only their own org's rows.
  const ORG_SCOPED = new Set([
    "sonic_cohort_exports",
    "org_intuizi_activations",
    "org_intuizi_sync_runs",
    "category_outcome_priors",
    "enterprise_datasets",
    "enterprise_records",
    "source_analyses",
    "prediction_runs",
  ]);
  if (ORG_SCOPED.has(table)) {
    if (!isEnterprise(role) || org !== ORG) return deny(role);
    return allow([{ id: "row1", organization_id: ORG }]);
  }

  if (table === "category_feedback") return allow([{ id: "f1", category: "emotional" }]);
  return deny(role);
};

const write = (role: Role, table: string) => {
  if (NO_POLICY_TABLES.has(table)) return deny(role);
  if (!signedIn(role)) return deny(role);
  if (role === "admin") return { data: null, error: null };
  if (table === "category_feedback") return { data: null, error: null };
  return deny(role);
};

/** Aggregate cohort view: org-scoped, never exposes a subject key. */
const cohortAggregates = (role: Role) => {
  if (role === "admin" || isEnterprise(role)) {
    return allow([
      {
        cohort_id: "c1",
        slug: "night-drive",
        name: "Night drive",
        member_count: 412,
        narrative: "Late-night low-tempo listening",
      },
    ]);
  }
  return deny(role);
};

const ALL_ROLES: Role[] = ["anon", "user", "moderator", "viewer", "analyst", "owner", "admin"];

describe("Ingest ledger & queue health (step 2.5) — admin only", () => {
  it.each(["intuizi_ingest_files", "intuizi_score_queue", "job_worker_state"])(
    "%s is admin only",
    (table) => {
      for (const role of ALL_ROLES) {
        const res = read(role, table);
        if (role === "admin") expect(res.data).not.toBeNull();
        else expect(res.data).toBeNull();
      }
    },
  );
});

describe("Taxonomy & crosswalk (step 5) — read for signed-in, write for admin", () => {
  it("every signed-in role reads taxonomy nodes", () => {
    for (const role of ALL_ROLES.filter(signedIn)) {
      expect(read(role, "taxonomy_nodes").data).not.toBeNull();
    }
    expect(read("anon", "taxonomy_nodes").data).toBeNull();
  });

  it("only admin can edit or approve taxonomy", () => {
    for (const role of ALL_ROLES) {
      const res = write(role, "taxonomy_nodes");
      if (role === "admin") expect(res.error).toBeNull();
      else expect(res.error).not.toBeNull();
    }
  });
});

describe("Cohorts (step 6) — aggregates for enterprise, never subject keys", () => {
  it("raw cohort table stays admin only", () => {
    expect(read("admin", "sonic_cohorts").data).not.toBeNull();
    for (const role of ALL_ROLES.filter((r) => r !== "admin")) {
      expect(read(role, "sonic_cohorts").data).toBeNull();
    }
  });

  it("sonic_cohort_members is unreachable for every non-service role, admin included via API", () => {
    for (const role of ALL_ROLES) {
      expect(read(role, "sonic_cohort_members").data).toBeNull();
    }
  });

  it("enterprise roles read aggregates without any subject_key", () => {
    for (const role of ENTERPRISE) {
      const res = cohortAggregates(role);
      expect(res.error).toBeNull();
      const rows = res.data as Record<string, unknown>[];
      expect(rows[0].member_count).toBe(412);
      expect(Object.keys(rows[0])).not.toContain("subject_key");
    }
  });

  it("consumer and moderator cannot read cohort aggregates", () => {
    for (const role of ["user", "moderator", "anon"] as Role[]) {
      expect(cohortAggregates(role).data).toBeNull();
    }
  });
});

describe("Activation exports (step 6) — org scoped for enterprise, full for admin", () => {
  it("enterprise sees only its own org's exports and grants", () => {
    for (const table of ["sonic_cohort_exports", "org_intuizi_activations"]) {
      for (const role of ENTERPRISE) {
        expect(read(role, table, ORG).data).not.toBeNull();
        expect(read(role, table, OTHER_ORG).data).toBeNull();
      }
    }
  });

  it("consumer and moderator see no exports; admin sees all", () => {
    expect(read("user", "sonic_cohort_exports").data).toBeNull();
    expect(read("moderator", "sonic_cohort_exports").data).toBeNull();
    expect(read("admin", "sonic_cohort_exports", OTHER_ORG).data).not.toBeNull();
  });
});

describe("Retention & compliance (step 7)", () => {
  it("retention run history is admin only", () => {
    for (const role of ALL_ROLES.filter((r) => r !== "admin")) {
      expect(read(role, "retention_runs").data).toBeNull();
    }
    expect(read("admin", "retention_runs").data).not.toBeNull();
  });
});

describe("Scoring internals (steps 3-4, 8)", () => {
  it("bridges and the control registry are admin-only debug surfaces", () => {
    for (const table of ["embedding_bridges", "control_registry", "control_audit"]) {
      for (const role of ALL_ROLES.filter((r) => r !== "admin")) {
        expect(read(role, table).data).toBeNull();
      }
    }
  });

  it("enterprise reads org priors and six-axis outputs, but nothing cross-org", () => {
    for (const role of ENTERPRISE) {
      expect(read(role, "category_outcome_priors", ORG).data).not.toBeNull();
      expect(read(role, "category_outcome_priors", OTHER_ORG).data).toBeNull();
      expect(read(role, "source_analyses", ORG).data).not.toBeNull();
    }
  });
});

describe("Consumer tier — flywheel only", () => {
  it("has no access to any Intuizi-derived table", () => {
    for (const table of [
      "intuizi_identifiers",
      "intuizi_ingest_files",
      "intuizi_score_queue",
      "sonic_cohorts",
      "sonic_cohort_members",
      "sonic_cohort_exports",
      "org_intuizi_activations",
    ]) {
      expect(read("user", table).data).toBeNull();
    }
  });

  it("can contribute consented feedback examples", () => {
    expect(write("user", "category_feedback").error).toBeNull();
    expect(read("user", "category_feedback").data).not.toBeNull();
  });
});
