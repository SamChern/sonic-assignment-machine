# Step 11 — closing the last gaps in the Predict loop

Most of Step 11 already shipped and works: the brief-to-profile and seed-to-profile paths, kNN retrieval with the sliders as re-weighting only, the reach–resonance curve with a confidence band, "Save run" writing a `sonic_cohorts` row, ridge + bootstrap intervals with a minimum-rows gate and greyed-out "not yet distinguishable" axes, counterfactual sliders, exposed-vs-holdout lift written back as outcome priors, and pixel snippets that capture gclid/UTM with Consent Mode v2 defaults.

Four things are genuinely unfinished. This plan finishes those and nothing else.

## 1. Nightly cohorts get no holdout slice

The manual "Save run" path in Predict-Users carves a deterministic ~10% holdout, but the nightly cohort builder writes members without it. Every cohort produced automatically therefore exports 100% of its members, so pixel events can never split into exposed vs. holdout and the lift panel stays empty for those cohorts.

Fix: one shared holdout rule used by both paths.

- Extract the deterministic hash-based split into a single shared helper (same FNV-1a on `cohort_slug + subject_key`, same `activation.holdout_pct` control key) so both writers agree and a re-run never reshuffles who is held out.
- Use it in the nightly builder when inserting members.
- At export time, if an eligible cohort has zero held-out members (legacy rows written before this change), flag the slice first, then export — so no activation file ever goes out without a measurement control.

## 2. Lift fitting runs in the edge function, not on EC2

Step 11c requires the regression to run on the worker. The Predict-Outcomes panel already routes its fit to the EC2 `fit_ridge` endpoint with a local fallback; the lift job still fits every axis in-process, which is the heavier of the two jobs.

Fix: move that remote-or-local fit helper into shared code and use it for the per-axis lift fits too, keeping the existing local fallback and the same breaker behaviour. The panel keeps reporting which engine produced the numbers.

## 3. Activation floor is a hidden constant

The 1,000-member export floor is hardcoded. Keep the floor mandatory, but surface it in the admin Control Room as a registry knob with a hard lower bound so it can be raised (never lowered below 1,000) without a code change — consistent with the project rule that pipeline tunables live in `control_registry`.

## 4. No tests for the four verification claims

Add tests that assert exactly what Step 11 says must be true:

- a nonsense brief still returns a bounded, sane 6-axis profile (all axes inside the 20–90 band, no NaN);
- moving the sliders re-orders results but never changes the retrieved candidate set (retrieval base comes from kNN);
- with a KPI dataset below the minimum-rows gate the outcomes panel refuses category-level claims instead of inventing them;
- an export produces a non-empty holdout and, once pixel rows exist for both arms, a lift number with an interval.

## Technical notes

- New `supabase/functions/_shared/holdout.ts` (deterministic split) and `_shared/ridgeRemote.ts` (the `fitRemoteOrLocal` helper lifted out of `predict-outcomes`).
- Edited: `cohort-builder/index.ts` (holdout on insert), `activation-export/index.ts` (backfill guard), `activation-lift/index.ts` (remote fit), `predict-users/index.ts` (use the shared helper), `_shared/activationFile.ts` (read the floor from the registry with a 1,000 hard minimum).
- One migration: register `activation.min_members` in `control_registry` with bounds; no table changes.
- Tests under `src/test/` in the existing style, mocking the backend client — no new schema and no changes to the shipped UI controls.
