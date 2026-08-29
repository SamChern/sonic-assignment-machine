# Step 7 — finish the 90-day retention mirror and compliance wiring

Most of Step 7 is already live: the nightly 90-day purge and the nightly custody scan both run on schedule (last runs 03:15 and 03:45 UTC, logged to `retention_runs`), the sensitive-class suppression flag and matching rules exist, and the admin compliance card is on the EC2/health admin page.

Four real gaps remain, found by reading the live data rather than the code alone.

## 1. The custody scan is failing right now — 491 raw device-ID-shaped keys

Last night's scan came back `failed` with `violations_total: 491`: that many rows in the Intuizi identifier table hold a UUID-shaped key (`8-4-4-4-12` hex) instead of a one-way-derived 32-hex EID. These came in through an early ingest of Activation 5498. Every other scanned surface (cohort members, audio sources, score queue, IP shapes) is clean.

Fix, in this order:

- Re-derive each of the 491 keys into the standard uppercase 32-hex EID with the same one-way derivation ingest uses now, carrying the rollups, tags, embeddings and any cohort membership over to the new key.
- Where a derived key collides with an existing subject, merge into the existing subject and drop the duplicate rather than keeping both.
- Delete any of the 491 that have no signal inside the 90-day window instead of re-keying them — retention already covers them.
- Re-run the scan and confirm `clean: true`.

No raw key values will be printed, logged, or shown in the UI at any point.

## 2. The compliance card under-reports violations

The card reads the scan result from the wrong fields, so it shows "0 found" and a green check even on the failed run above. It will be corrected to read the actual per-table counts, mark the checklist row red when any violation exists or when the last scan failed, and name which table the violations sit in.

## 3. Suppression has never been seeded, and imports can bypass it

The suppressed-node count is 0. That is currently correct — no visitation/POI classes have been ingested yet (the taxonomy holds only CTV genre, AudioSet, IAB, web and demo classes; the eight health/worship-sounding entries are content genres and must stay taggable). But suppression is applied only at the moment a tag is first resolved, so classes created by the taxonomy import paths would never be evaluated.

- Add a suppression refresh routine that re-evaluates every existing POI/visitation node against the sensitive patterns and flags matches, so a class created before or outside the tagging path cannot stay unsuppressed.
- Run it nightly alongside retention, and expose it as a button on the compliance card.
- Make the card distinguish "0 flagged because no visitation data has been ingested" from "0 flagged because nothing was checked".

## 4. A failed nightly run alerts nobody

A failure is only visible to an admin who opens the compliance card. A persistent alert will appear on the admin dashboard whenever the most recent retention run or custody scan failed, or the last scan was not clean, linking straight to the compliance card. The enterprise-facing retention strip stays as it is — it will not surface admin failure detail.

## Verification

- Custody scan returns clean, and the 491 rows are either re-keyed or purged, with counts recorded in `retention_runs`.
- A deliberately re-inserted bad-shaped key is caught by the scan and turns the card's checklist row red.
- Suppression refresh flags a seeded sensitive POI test class and leaves the eight content genres alone; a tag for the suppressed class never reaches scoring.
- Admin dashboard shows the alert while the last run is failed, and clears once a clean run lands.

## Technical notes

- Re-keying and merging run through a `SECURITY DEFINER` migration function plus a data pass; scan and purge functions stay admin/service-only.
- Suppression refresh reuses `SENSITIVE_SQL_PATTERNS` from `supabase/functions/_shared/sensitiveTaxonomy.ts` so SQL and edge-function matching cannot drift.
- Card fixes are in `src/components/admin/ComplianceCard.tsx`; the alert is a small component consumed by `src/pages/AdminDashboard.tsx`, keeping both files under the 500-line ceiling.
- Nightly schedule additions follow the existing pg_cron pattern; retention window keeps reading `retention.days` from the Control Room.
