# Intuizi MCP inside Admin (console + data, no pipeline changes)

## Why this fits without touching the core

The app already has a generic MCP layer: a provider registry (`kind: "mcp"` with `MCP_SERVER_URL` / `MCP_AUTH_SCHEME` / `MCP_AUTH_TOKEN` / `MCP_HEADERS_JSON` + capability toggles), an admin-only `mcp-call` invoker that speaks `tools/list` and `tools/call` over Streamable HTTP or SSE, and an `mcp-test` handshake tester that logs into `integration_test_history`. Intuizi's server is stateless Streamable HTTP at `https://console.intuizi.com/api/v2/mcp` with a static `Authorization: Bearer <MCP token>` — exactly what that layer already sends. So Intuizi becomes a registered MCP provider, not a new subsystem.

The semantic layer stays untouched. Intuizi MCP controls the *console side* (audiences, activations, cohorts, projects, usage). Data still arrives the way it does today — activation delivers files to `s3://intuizi-export-delivery/<folder>/`, and the existing `intuizi-ingest` + ontology/normalization pipeline scores them. MCP only removes the manual console clicking at the front of that chain and the manual key-copying at the back.

## The optimal integration path

```text
Admin > Integrations > MCP Servers > Intuizi   (token pasted once, stored encrypted)
        │  tools/list, tools/call via existing mcp-call
        ▼
Admin > Intuizi Console panel
  projects → audiences (estimate → create → poll to 104) → activation → delivery
        │  get_activation returns the S3 destination + delivered keys
        ▼
"Ingest delivered files" → existing intuizi-ingest (validate_keys → ingest)
        ▼
untouched: taxonomy tagging → 6-category scoring → calibration → speech-skew normalization
```

Read-only first, writes gated. Everything the panel does by default is a read tool. Create/delete tools (`create_audience`, `create_activation`, `delete_*`, lookalikes, POI writes) sit behind an explicit confirm dialog and a capability toggle, so nothing spends Intuizi quota or mutates the account without a deliberate admin click.

## What gets built

**1. `mcp_intuizi` provider entry** in `src/config/integrations.ts`: name, docs link, setup steps (My Account > MCP Tokens > Generate new token; or the headless `POST /api/v2/auth/mcp-token` call), prefilled server URL and `Bearer` scheme, `testEndpoint: "mcp-test"`. Capabilities extended with `tools.write` (default off) alongside the existing read toggles. `mcp_intuizi` is added to the allow-lists in `mcp-call` and `mcp-test`.

**2. Admin Intuizi Console panel** (`src/components/admin/IntuiziConsolePanel.tsx`, rendered on `/admin/integrations` under the MCP tab and linked from Integration Status):
- Connection strip: handshake status, discovered tool count, and `get_usage` (scanned bytes, % of monthly limit) so quota is visible before any run.
- Browse tabs backed by `list_projects`, `list_audiences`, `list_activations`, `list_cohorts`, and `lookup_reference` (dataset/catalog picker, e.g. `common` / `dataset-types`).
- Audience detail drawer: `get_audience` with status, `eligibility` (allowed / reasons / `unique_scids`, `eid_scid_ratio`) and `totals`.
- Guided build flow: `estimate_audience_size` → `get_audience_estimate` → confirm → `create_audience` → poll `get_audience` until status `104` → `create_activation` → poll `get_activation`. Each create sends an `idempotency_key` so retries can't duplicate.
- Delivery handoff: when an activation reports Completed, the panel shows the destination keys and a one-click "Ingest these" that calls the existing `intuizi-ingest` `validate_keys` + ingest actions — closing the loop that is manual copy/paste today.
- Raw tool console (collapsed): pick any discovered tool, edit JSON arguments, run. Write tools require the confirm step.

**3. `intuizi-mcp` edge function** — a thin, admin-guarded wrapper over `mcp-call` that: keeps a small allow-list of tool names per capability toggle, enforces the confirm flag for write tools, honours `Retry-After` on 429 with bounded backoff (Intuizi allows 120 reads/min, 30 writes/min, 120 MCP req/min), and surfaces Intuizi's error envelope verbatim to the UI instead of a generic 500. Polling loops live in the browser panel, not in a long-running function.

**4. Run ledger** — one table, `intuizi_mcp_runs`: tool name, arguments summary, idempotency key, resulting Intuizi resource id, status, error text, admin user id, timestamps. Admin-read-only under RLS with grants limited to `authenticated` (admin policy) and `service_role`. This gives an audit trail for every console-side action and lets the delivery handoff remember which activation produced which S3 keys.

**5. Optional later step (not in this build):** register an Intuizi webhook receiver for `audience.completed` / `activation.completed` so delivery triggers ingest without the panel polling. Called out here as the follow-on; the polling path works standalone.

**6. Runbook** in the repo: token minting and rotation, revocation semantics (password change kills every token and one-click connector; API revoke is all-or-nothing), rate limits, and the audience→activation→ingest sequence.

## Guardrails on app integrity

- No change to scoring, calibration, normalization, `intuizi_identifiers`, or the S3 SigV4 driver.
- MCP token stored in `integration_credentials` like every other credential — read only by edge functions, never reaching the browser.
- Admin-only end to end (`requireAdmin`), consistent with the existing MCP functions.
- Destructive tools (`delete_audience`, `delete_activation`, `delete_cohort`, `delete_poi_submission`) are exposed only behind the write toggle plus a typed confirmation.

## Open choice

Uploads (`create_upload` reserves a presigned PUT but cannot move bytes) and file-sourced cohorts are omitted from this build; say the word and the panel gets a cohort-from-file step that PUTs through the backend.
