# Step 12 — remaining consolidation work

Most of Step 12 has already landed: the consumer page is three tabs (Listen / Understand / Library) with a light `ConfidenceSummary`, the enterprise Workspace is four groups with secondary tabs, `AdminDashboard` is a thin 180-line overview, `useUiPreference` has a JSON variant with cross-device hydration, and a 500-line ceiling test with a shrink-only debt ledger is enforced in CI.

Five items from the audit are still open. No business logic, scoring math, or edge functions change in any of them.

## 1. One graph renderer, two adapters

`NetworkVisualization` (767 lines) and `AggregateNetworkVisualization` (887 lines) still each own a full D3 force-graph implementation; only zoom is shared today.

- Add `src/components/graph/SemanticGraph.tsx` — the single renderer: force simulation, link strength rendering, node draw, hover/click label behavior (hidden by default, show on hover, pin on click), zoom controls, legend slot.
- Add `src/components/graph/adapters/` with `singleSubject.ts` and `aggregate.ts`, each turning its existing input data into the shared `{nodes, links}` shape already typed in `src/components/graph/types.ts`.
- Both existing components become thin wrappers (< 200 lines each) that pick an adapter and pass presentation props; the duplicated drawing code is deleted.
- Node connection strength and the existing visual behavior must render identically — Playwright screenshots before/after for both surfaces.

## 2. Fold FingerprintComparison into the Scope compare lens

`ScopeCompareLens` currently just wraps the standalone 573-line `FingerprintComparison`.

- Move its silhouette overlay, matrix, and similarity readout into `src/components/visuals/compare/` as three subcomponents, consumed directly by the compare lens.
- Delete `FingerprintComparison.tsx` and its ledger entry; update `AdminWorkbench` and any tests that referenced it.

## 3. Finish the cross-device preference migration

Three raw `localStorage` holdouts remain, all user-facing:

- `PostIngestionWizard` phase-run history → `useUiPreferenceValue` JSON variant so wizard progress follows the user.
- `Ec2StatusPanel` health history → same treatment (admin-only, still cross-device).
- `src/lib/audioscope/preference.ts` scope/motion preference → hook-backed, with `localStorage` kept only as the instant-paint cache and the anonymous-visitor fallback.

## 4. Pay down the ceiling on every touched file

Each file this work opens must come out at or under 500 lines by extraction, not rewrite: `NetworkVisualization`, `AggregateNetworkVisualization`, `PostIngestionWizard`, and the new graph/compare modules. `ConfidenceBreakdownPanel` (1,235) is opened only to split its data-loading hook and section subcomponents out, which brings it under the ceiling; its full detail stays where it already is — the admin-only `/admin/semantic` route — while consumers keep the summary.

Files not touched by items 1–3 stay on the ledger untouched (they may only shrink, never grow).

## 5. Verify

- Full Vitest suite plus the Deno function tests, with tests updated for moved components.
- `check-bundle-size.mjs` passes; route inventory unchanged.
- Cross-device check: set a Workspace group, a wizard position, and a scope preference in one session, then confirm they hydrate in a second signed-in browser context.
- Mobile overflow check still green at 390px.

## Technical notes

- The shared renderer keeps `useGraphZoom`/`GraphZoomControls` as-is rather than reimplementing zoom.
- Adapters are pure functions in `src/lib`-style modules so they are unit-testable without a DOM.
- The preference migration reuses the existing `validate` guard so stale cached shapes fall back rather than crash.
