# Steps 16 & 17 — Four doors, one house + the Creator door

Two net-new steps, built on the existing engine. No scoring logic changes: the six-axis ontology, Semantic Scope, archetypes, signatures, grounding packs and priors stay exactly as they are. What changes is who sees which framing, plus one new creator surface with its own tables.

Note on work already in flight: the Step 2 ingest replay is running now (one 108M-row file processing, six queued). I found the real reason it is slow — the worker reads each chunk with `LIMIT/OFFSET` over the Parquet, so every chunk re-scans everything before it. That fix is tracked separately and does not block Steps 16/17.

---

## Step 16 — The persona experience layer

### 16.0 Routing and persona
- Add `profiles.persona` (`curious` | `marketing` | `creator` | null). Purely a view preference — every permission check stays on `app_role` / `org_role`.
- One-question first-visit chooser: "What brings you here?" → three cards. Admins skip it (role-detected). Choice saved to the profile; guests keep it in local storage until they sign up.
- Door switcher in the avatar menu, so an enterprise user can show a client the consumer view and switch back.
- Default landing per persona: curious → `/`, marketing → `/workspace`, creator → `/creator`, admin → `/admin`.

### 16a — Consumer door (rebuild of `/`)
- **One universal input**: music search, file drop, pasted link, or plain words ("rainy Sunday, driving"). All four routes end at the same analysis path — no mode switcher.
- **One result view**: Semantic Scope with its three lenses, six-axis fingerprint drawing itself, archetype card with anchors, the 3.5s signature with play, and one plain-language sentence above it. Nothing else on screen.
- **One expander**: "How it heard this" — top tags plus the grounding badge. That is the ceiling of disclosure here.
- **Share card**: fingerprint + archetype + signature + short permalink (`/s/:token`), rendered as an image for social. Shares are also stored as labeled examples for the priors.
- **Ladder, not a wall**: after the result, show the two nearest sonic cohorts computed from their own vector and what those cohorts watch/listen to/visit → "See what this does at scale".
- **Quota**: one analysis with no signup, save/share requires a free account, three per month free, the fourth prompts an upgrade.
- Mobile-first at 390px; the Scope must be beautiful with a thumb on the play button.

### 16b — Enterprise door (`/workspace`)
- Landing becomes three job cards — *Find an audience* · *Predict performance* · *Activate a segment* — each opening its panel with inputs pre-focused, replacing the widget dashboard.
- **Brief box** as the universal entry: a sentence in, a proposed profile out with removable tag chips, then slider refinement.
- **One Confidence chip** per result collapsing grounding level, sample sufficiency and CI width into *High / Moderate / Not yet distinguishable*, expandable to the honest detail.
- **Playbooks**: save any configured run (brief, weights, threshold, dataset filter) under a name and re-run it on new data in one click.
- **Client workspaces**: workspace switcher, per-client datasets/cohorts/playbooks, roll-up view for the agency lead.
- **Export**: client-ready one-pager (PDF, and PPT-compatible layout) plus CSV for the trading desk.
- **"Explain this to my client"**: a plain-marketing-English paragraph generated from the actual scores and top tags, labeled as generated.

### 16c — Admin door (`/admin`)
- A depth toggle instead of new pages: **Glance · Operate · Diagnose**, remembered per admin.
  - Glance: worker heartbeat, semantic service, queue depth, spend/usage, active users, last night's ingest summary, approvals as a count.
  - Operate: Control Room knobs, Sound Library coverage and auto-curate approvals, cohort/activation approvals, user and role management — all audited.
  - Diagnose: the ingest ledger with per-file state, worker logs, failed/skipped files with reasons, six-axis drift vs priors, resolution queue.
- **Command palette (⌘K)**: pages, cohorts, files, users, EIDs — one input replacing fourteen pages of navigation.
- **"What changed since yesterday" digest card**: files processed, scores drifted past threshold, new unresolved symbols, failures.
- **Preview as role**: see the consumer / enterprise viewer / creator view exactly, to catch permission leaks.

**Verify 16:** a first-time visitor hears a signature in under 20 seconds with no signup; an enterprise viewer saves and re-runs a Playbook; ⌘K finds a cohort by name; preview-as-role leaks no admin affordances.

---

## Step 17 — The Creator door: Originality Ledger and consented corpus

The UI states the honest frame plainly: SONICSIM sells understanding, provenance and positioning today, and is building licensing revenue as real infrastructure — not a promised royalty stream that depends on third parties.

### 17a — Understand
- Upload files or connect a catalog; each work gets the same fingerprint, archetype and signature, plus three creator-only readings:
  - **Divergence with coherence**: novelty vs resonance plotted, quadrants labeled *Familiar · Original · Inaccessible · Derivative*, with the caveat that this measures distance in a learned space, not artistic worth.
  - **Lineage map**: nearest regions in the grounded space using historical/archetypal anchors only — never living-artist comparisons.
  - **Catalog arc**: divergence and resonance over time across the catalog.

### 17b — Register: the Originality Ledger
- Every registered work gets a timestamped, content-derived fingerprint (embedding hash, never the audio) written append-only, with the creator's rights attestation.
- **Machine-use terms** per work or catalog-wide: *No machine training* · *Analysis only* · *Available for licensing* · *Public domain contribution*, stored machine-readably.
- **Enforced first by us**: the Step 14 pack build excludes `no_training` and withdrawn works, and the pack manifest records the included work ids so exclusion is verifiable.
- **Attribution receipts**: "Your work is in Pack v3, used in 14,203 analyses this month," derived from pack manifests.
- Record format aligned with C2PA-style assertions so it interoperates.

### 17c — Monetize
- Opt in to the Grounding Corpus; revenue share per license with usage-weighted allocation from pack manifests.
- Two clearly separated paths: live now — SONICSIM licenses the corpus for its own packs and enterprise products and pays contributors; built-for — external dataset licensing with SONICSIM as clearinghouse. The dashboard shows which path is active; they are never blurred.
- **Creative brief matching**: when an enterprise brief seeks a sonic profile, surface opted-in creators whose fingerprints resonate — commission work routed by resonance.
- Dashboard: works registered, terms, pack inclusions, analyses influenced, brief matches, earnings. Plain numbers.

**Guardrails (non-negotiable):** rights attestation required at upload with clear liability language; no-training exclusion enforced in code and asserted in the manifest; no living-artist similarity claims; creator audio in private storage scoped to pack builds and never served through the app; withdrawal excludes future packs and records the date honestly rather than rewriting history.

**Verify 17:** a no-training work never appears in a built pack manifest; withdrawal excludes it from the next build with a recorded date; a creator sees only their own works; the quadrant chart reads sensibly for a catalog of one.

---

## Technical notes

- **Migrations**: `profiles.persona`; `share_cards` (token, analysis id, vector snapshot, created_at) for consumer permalinks; `playbooks` (org-scoped config + last run); `creator_works`, `originality_ledger` (append-only), `pack_inclusions`. Every new public table gets GRANTs plus RLS: creators see only their own works, admins see all, share cards readable by token only, playbooks scoped by `has_org_access`.
- **Edge functions**: `share-card` (render/resolve permalinks), `client-narrative` ("explain this to my client", Lovable AI), `onepager-export` (PDF), `creator-register` (attestation + ledger write), `brief-match` (resonance matching); Step 14's pack builder gains the no-training/withdrawn filter and manifest work ids.
- **Frontend**: new `/creator`, `/s/:token`; `Index.tsx` rebuilt around a single input; `Workspace.tsx` landing replaced by job cards; `AdminDashboard.tsx` gains the depth toggle, ⌘K palette (cmdk, already available via shadcn), digest card and preview-as-role. All of it reuses the existing consolidated components and tokens — no new visual system.
- **Build order**: 16.0 persona plumbing → 16a consumer → 16c admin depth + ⌘K → 16b enterprise (playbooks/export are the largest chunk) → 17a/b → 17c.
- roadmap.md gets Steps 16 and 17 as tracked tasks on approval.
