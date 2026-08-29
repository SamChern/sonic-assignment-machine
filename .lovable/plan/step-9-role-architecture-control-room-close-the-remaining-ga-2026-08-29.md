# Step 9 — Role architecture & Control Room: close the remaining gaps

Most of Step 9 already shipped in this project (verified this turn):

- `control_registry` + `control_audit` exist, admin-only via `has_role(auth.uid(),'admin')`, with a write-validation trigger and an audit trigger.
- 13 knobs are seeded with bounds, including `knn.k`, `prior.blend_weight`, `bridge.active_id`, `ingest.queue_high_water`, `cohort.k`, `retention.days`, `scope.window_seconds`.
- The 60s TTL reader (`_shared/control.ts`) is used by `analyze-audio`, `intuizi-score-worker`, `cohort-builder`, `scope-window-score`, `predict-users`, `predict-outcomes`, `activation-lift`; the retention card reads `retention.days` before calling the purge.
- The admin Control Room page renders grouped sliders/toggles from the registry with inline audit history and one-click revert; its RBAC test suite passes (17 tests).
- `sonic_cohort_members` has no policies at all (unreachable to every non-service role); enterprise roles reach cohort aggregates only through the `org_cohort_aggregates` function, which exposes no `subject_key`.

So this step only needs the two pieces that are genuinely missing.

## 1. Encode the full per-step role matrix as tests

Today only the Control Room / cohort rows of the matrix are covered. Add one RBAC suite that walks the whole table — consumer `user`, enterprise org member (`viewer`/`analyst`/`owner`), `moderator`, `admin`, plus `anon` — asserting for each surface:

- Ingest ledger & queue health (`intuizi_ingest_files`, `intuizi_score_queue`, `job_worker_state`): admin only; everyone else denied.
- Taxonomy + crosswalk: all signed-in roles read, only admin writes/approves.
- Cohorts: admin reads `sonic_cohorts`; enterprise reads aggregates via the org function and never receives a `subject_key` key in any row; `sonic_cohort_members` unreadable for all non-service roles.
- Activation exports: enterprise sees only rows for orgs it belongs to; admin sees all; consumer none.
- Retention & compliance: `retention_runs` admin only.
- Scoring internals (`category_outcome_priors`, `embedding_bridges`, `control_registry`): priors org-scoped, bridges + registry admin only; enterprise sees six-axis outputs (`source_analyses` scoped to its org) but no internals.
- Consumer tier: no access to any Intuizi-derived table, and its own consented analyses can write `category_feedback`.

Follows the existing `ControlRoomRbac.test.tsx` pattern (role-switch mock over the client, one describe block per surface) so it stays a fast unit suite rather than a live-DB test.

## 2. Org-scoped retention summary for enterprise

The compliance card is admin-only today, but the matrix promises enterprise members an org-scoped summary. Add a read-only compliance strip in the enterprise workspace showing the active retention window (from `retention.days`) and the last purge timestamp for that org, sourced from an org-scoped security-definer function so no cross-org rows leak. No purge controls for enterprise — trigger stays admin.

## Verification

- Change `knn.k` in the Control Room, confirm the next `analyze-audio` call picks it up without a deploy, then use revert and confirm the prior value returns and the audit row is logged.
- New RBAC suite passes; database linter shows no new findings.

## Technical notes

- No schema change is required for item 1; item 2 adds one security-definer function returning an aggregate row per org (no `subject_key`, no member rows) plus its grants.
- Test files go under `src/components/admin/__tests__/` alongside the current RBAC suites; keep components under the 500-line ceiling enforced by `componentSize.test.ts`.
