# Admin path to provision enterprise accounts

Add one admin screen where you create a brand-new enterprise account and set exactly what it can reach — people and their roles, which Intuizi data feeds it sees, its own site pixels, and how deep the SonicSIM/CLAP analysis goes. First account created this way: **Rubinstein Law**, with everything switched on.

Nothing about how the app analyses audio or scores data changes. This only adds a provisioning door and makes the enterprise workspace respect the switches.

## New admin screen: Enterprise accounts

Path: Admin → Enterprise accounts (`/admin/enterprise`). A four-step flow per account, all editable later:

1. **Account** — name, short slug, plan label, owner email. Creating it sets up the account and its owner in one action.
2. **Access switches** — per-account toggles:
   - Intuizi console and data feed
   - Semantic model depth (full six-category scoring)
   - CLAP audio grounding
   - EID-level enrichment and append
   - Site pixels and tracking
   - Predict users / Predict outcomes
   - Enrichment preview (see below)
3. **Data feeds** — pick which Intuizi activations this account can sync, with a "grant all current activations" button. Reuses the existing activation-grant records, so the sync path is unchanged.
4. **People** — invite by email with Owner / Analyst / Viewer, see who has actually signed in, change or remove roles.

The screen also lists every existing account with its member count, granted feeds, and which switches are on, so you can adjust one later without re-running the flow.

## What the enterprise user sees

The workspace tabs and panels appear only when the matching switch is on. An account with everything on looks exactly like it does today; a narrower account simply shows fewer tabs. Owners still edit the six categories; analysts run and read; viewers read only.

**Enrichment preview** (new panel, on when the switch is on): for a chosen Intuizi feed it shows, at the mobile-device/EID level, which signals the account already has, what SonicSIM appends (the six semantic scores, audio grounding, sonic tags), how much of the feed can be appended, and which of their KPIs — site traffic, CTR, CPC, page views, VCR, time on site — those scores most influence. Read-only, built from the account's own granted feeds and their pixel/KPI data. No formal test-vs-control experiment in this build.

## Rubinstein Law

Created with owner `sam.chernoff@gmail.com`, every access switch on, and all current Intuizi activations granted. Its pixel/tracking panel is ready for you to paste in their tag IDs.

## Technical notes

- New `public.org_capabilities` table: one row per organization holding the boolean switches plus `updated_by`/timestamps, with grants, RLS (members read their own org, platform admins full access), and an updated-at trigger. No columns added to `organizations`, so nothing existing shifts.
- `admin-org-setup` edge function gains actions: `provision_org` (create org + owner membership + default capabilities in one call), `set_capabilities`, `grant_activations` (bulk, including "all current"), and `org_detail` (org + capabilities + grants + members). Existing actions stay as they are.
- `useOrganization` returns a `capabilities` object read from `org_capabilities` (defaults to all-on when no row exists, so current accounts are unaffected). `Workspace.tsx` filters `GROUPS`/`ALL_TABS` by capability and falls back to a permitted tab if a deep link points at a hidden one.
- Enrichment preview is a new `src/components/enterprise/EnrichmentPreviewPanel.tsx` reading existing `org_intuizi_activations`, `intuizi_identifiers` coverage aggregates, `source_analyses` scores and `pixel_events` KPI rollups through existing admin/org-scoped RPCs; EID-level detail stays service-role only and is shown as counts and coverage, not raw subject keys.
- Admin route added under the existing nested `/admin` shell (single `RequireAdmin` + error boundary), lazily loaded like its siblings.
- Rubinstein Law is seeded through the new `provision_org` action, not a hardcoded record.
