# Audit + finish Steps 16b, 16c, 17 — plus an admin Guide & Glossary

## What the audit found

Checked the uploaded plan file against the repo and database.

Already in place (Steps 1–15, 16.0, 16a):
- Schema spine, semantic service, ingest worker, crosswalk, cohorts/activation export, retention, Control Room, Scope, Predict loop, Resolver, Sound Library, Sonic Signatures — all have tables, edge functions and admin routes.
- Persona plumbing (`profiles.persona`, chooser, door switcher) and the Consumer door with share permalinks and quota.

Not built yet — tables exist, but no UI and no edge functions:
- `playbooks`, `share_cards`, `creator_works`, `originality_ledger`, `pack_inclusions` are all present in the database.
- There is no `/creator` route, no Playbooks surface, no command palette usage (`cmdk` is only the unused shadcn `command.tsx`), and none of `share-card`, `client-narrative`, `onepager-export`, `creator-register`, `brief-match` exist under `supabase/functions/`.

So 16b, 16c and 17 are open, and the roadmap already reflects that.

---

## Step 16b — Enterprise door (`/workspace`)

- Landing becomes three job cards: *Find an audience* · *Predict performance* · *Activate a segment*, each opening its panel with the input pre-focused.
- **Brief box**: a sentence in, a proposed profile out as removable tag chips, then slider refinement (reuses the existing Predict weighting).
- **Confidence chip** per result: collapses grounding level, sample sufficiency and CI width into *High / Moderate / Not yet distinguishable*, expandable to the honest detail.
- **Playbooks**: save a configured run (brief, weights, threshold, dataset filter) by name into `playbooks`, re-run on new data in one click, org-scoped.
- **Client workspaces**: workspace switcher with per-client datasets, cohorts and playbooks, plus a roll-up for the agency lead.
- **Export**: client one-pager (PDF-ready layout) and CSV for the trading desk.
- **"Explain this to my client"**: plain-marketing-English paragraph generated from the actual scores and top tags, labeled as generated.

## Step 16c — Admin door (`/admin`)

- **Glance · Operate · Diagnose** depth toggle, remembered per admin, over the existing surfaces rather than new pages.
- **⌘K command palette**: pages, cohorts, files, users, EIDs in one input.
- **"What changed since yesterday" digest card**: files processed, scores drifted past threshold, new unresolved symbols, failures.
- **Preview as role**: render the consumer / enterprise viewer / creator view to catch permission leaks.

## Step 17 — Creator door (`/creator`)

- **17a Understand**: upload or connect a catalog; each work gets fingerprint, archetype, signature, plus novelty-vs-resonance quadrants (*Familiar · Original · Inaccessible · Derivative*), a lineage map using historical/archetypal anchors only, and a catalog arc over time.
- **17b Register**: append-only Originality Ledger entries with content-derived fingerprint (never the audio) and rights attestation; machine-use terms per work (*No machine training · Analysis only · Available for licensing · Public domain*); the pack builder excludes `no_training` and withdrawn works and records included work ids in the manifest; attribution receipts derived from manifests.
- **17c Monetize**: corpus opt-in with usage-weighted revenue share, creative brief matching to opted-in creators, and a plain-numbers dashboard. Live-now and built-for paths stay visually separated.
- Guardrails: attestation required at upload, no living-artist comparisons, creator audio in private storage never served through the app, withdrawal recorded with an honest date.

## Admin Guide & Glossary (`/admin/guide`)

Database-backed so you can edit it in the app.

- New `admin_guide_entries` table: slug, title, kind (`glossary` | `runbook`), category, body (markdown), status (`live` | `partial` | `planned`), version, related routes/functions, sort order, updated timestamp. Admin-only read and write.
- Page has two tabs:
  - **Glossary**: searchable A–Z of the concepts — six axes, grounding levels, archetypes and signatures, EIDs and subject keys, cohorts and activations, packs, personas, Confidence chip, Control Room knobs.
  - **Runbook**: one card per subsystem with setup steps, the plan's verify line, current status badge and links to the live admin surface.
- Inline editing for admins (add / edit / archive entries), plus a "last updated" stamp so it stays current.
- Seeded from this audit: every step from the plan file with its real status, so 16b/16c/17 entries flip from `planned` to `live` as they land.
- Linked from the admin overview card grid.

---

## Technical notes

- Migrations: `admin_guide_entries` (with GRANTs, RLS admin-only, updated_at trigger) and its seed rows. Existing `playbooks` / `creator_works` / `originality_ledger` / `pack_inclusions` tables are reused as-is; only missing RLS/grant gaps get patched.
- New edge functions: `share-card`, `client-narrative` (Lovable AI), `onepager-export`, `creator-register`, `brief-match`; the pack builder gains the no-training/withdrawn filter and manifest work ids.
- New routes: `/creator`, `/admin/guide`. `Workspace.tsx` landing replaced by job cards; `AdminDashboard.tsx` gains the depth toggle, ⌘K palette (`command.tsx` already present), digest card and preview-as-role.
- All of it reuses existing tokens and consolidated components — no new visual system, and every component stays under the ~500-line ceiling.
- Build order: 16c admin depth + ⌘K + guide scaffold → 16b enterprise (playbooks and export are the biggest chunk) → 17a/b → 17c → guide seed refresh.
- roadmap.md updated with the audit result and these tasks.
