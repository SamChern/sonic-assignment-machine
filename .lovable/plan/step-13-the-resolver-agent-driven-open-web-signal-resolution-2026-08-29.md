# Step 13 — The Resolver: agent-driven open-web signal resolution

Goal: no Intuizi signal is wasted. When a delivered symbol (CTV genre, channel, app category, domain, POI brand) has no taxonomy node or no approved crosswalk, it gets queued, resolved once overnight by an agent with open-web lookup, and written back into the graph as an unreviewed proposal for your approval.

## Design rules held throughout

- Agent is never on the hot path. Ingest only writes a queue row; nothing calls a model inline.
- Knowledge is data, agent is replaceable: outputs are rows (description, 6-axis tendencies, crosswalk anchors, embedding). Model, budget, and batch caps live in `control_registry`.
- Tools exposed as MCP so any future model can drive them unchanged.
- Meaning is referenced from the open web; audio is never fetched or streamed. Licensed catalogs (Freesound CC, Jamendo) may be referenced as metadata and queued as grounding candidates for later training only.

## 1. Queue table (migration)

`public.resolution_queue`: `symbol`, `symbol_type` (ctv_genre | channel | app_category | domain | poi_brand | other), `context` jsonb (sample rows, activation, report type, observed count), `status` (pending | resolving | resolved | failed | skipped), `attempts`, `last_error`, `resolved_node_id`, `first_seen_at`, `last_seen_at`, timestamps. Unique on (`symbol_type`, lower(`symbol`)) so repeat sightings bump `last_seen_at`/count instead of duplicating. Service-role/admin only (grants + RLS: admins read, service role all).

Also add to `taxonomy_nodes`: `source` (default `'catalog'`), `reviewed` (boolean, default true for existing rows), `proposal` jsonb (description, tendencies, anchors, spend/trace), so agent nodes are distinguishable and reversible.

Registry rows: `resolver.enabled`, `resolver.model`, `resolver.daily_budget`, `resolver.batch_max`, `resolver.min_confidence`, `resolver.escalate_model`.

## 2. Ingest writes unknowns (no model calls)

In `_shared/ontology.ts` where a tag code is looked up in `taxonomy_nodes`, when the code is missing (or present with no approved crosswalk), upsert a `resolution_queue` row with light context and continue scoring exactly as today. Same for the rollup/promote path so both the SQS and HTTP-worker modes feed the queue. This is bounded: one row per distinct unknown symbol, ever.

## 3. `signal-resolver` edge function

Modelled on `intuizi-mcp` / `mcp-call`. Modes:

- `run` (nightly, service-role, after ingest): single-flight lease + paused-state guard, drains up to `resolver.batch_max` pending rows oldest-first. Per symbol: agent call with the tool belt → two-sentence semantic description, proposed 6-axis tendencies, top-3 AudioSet/IAB anchors with confidence → embed the description via `semantic-embed` → insert `taxonomy_nodes` row with `source='agent', reviewed=false`, crosswalk proposals in the existing `crosswalk.matches` shape so the Step 5 review UI picks them up unchanged → mark queue row resolved. Spend is accumulated per run; when `resolver.daily_budget` is hit the run stops, logs a partial state, and leaves the rest pending. Low-confidence results (< `resolver.min_confidence`) may escalate once to `resolver.escalate_model`, otherwise are marked `failed` with the reason.
- `resolve_one` (admin-guarded via `requireAdmin`): resolves a single symbol interactively for the Control Room "Resolve now" action.
- `status` (admin): queue depth by status, last run summary, today's spend, pause reason.

Error semantics follow the gateway contract: 402/403 park the job in a persisted paused state, repeated 429s back off and park until the next scheduled run; every entry point checks the paused row first.

## 4. MCP tool belt

Tools: `lookup_taxonomy` (existing `match_taxonomy_nodes` / `taxonomy-crosswalk` reads), `propose_crosswalk`, `embed_text` (`semantic-embed`), `search_web`. Exposed on the EC2 box following the existing `deploy/librosa-mcp` pattern, reachable through the same `mcp-call` bridge, so the Resolver's belt is model-agnostic. `search_web` uses an open-web metadata search provider; audio endpoints are excluded by allow-list.

## 5. Admin UI

- `IntuiziCatalogTree`: agent proposals appear with an `agent` badge and unreviewed styling; the existing approve/reject controls promote (`reviewed=true`, crosswalk approved) or discard them. Filter toggle for "unreviewed agent proposals only".
- Control Room: a Resolver card showing enabled/paused state, queue depth, today's spend against budget, last run summary, plus a "Resolve now" input for one symbol.
- Registry knobs editable from the existing Control Room registry table.

## 6. Verification

Seed a fake unknown channel; run the resolver; confirm a described, embedded, unreviewed node with crosswalk proposals; approve it and confirm the next ingest consumes the symbol without re-queueing; oversize the queue and confirm the budget cap halts with a logged partial state and remaining rows still pending.

## Decision needed: which model drives the agent

Default recommendation is the Lovable AI Gateway (no extra key, spend visible in the workspace, `resolver.model` selects the tier) with `search_web` served by the MCP tool belt. If you specifically want Claude, I add an Anthropic key to function secrets and call the Messages API with its native web search instead — the rest of the design is identical since the model id is just a registry row.
