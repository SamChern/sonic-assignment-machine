# Roadmap

## Done
- Step 14 — Sound Library: grounding packs, honest score levels (`grounding_level`), `/admin/sound-library` with coverage, gap curation, review queue, pack publishing.

## In progress
- Agent integrations (MCP): expose SonicSIMai tools over an MCP server so ChatGPT/Claude/Lovable can call them.
  - [ ] Confirm access model (OAuth vs public)
  - [ ] Tools + `defineMcp` entry, Vite plugin, deploy `mcp` function
  - [ ] Consent route + OAuth server activation (if OAuth)

## Step 16 — Persona experience layer (four doors, one house)
- [x] 16.0 `profiles.persona`, first-visit chooser, door switcher, per-persona landing
- [x] 16a Consumer door: universal input, single result view, share permalink, cohort upsell, quota
- [x] 16b Enterprise door: three job cards, brief box, Confidence chip, Playbooks, client workspaces, one-pager export, client narrative
- [x] 16c Admin door: Glance/Operate/Diagnose depth toggle, ⌘K palette, daily digest, preview-as-role

## Step 17 — Creator door (Originality Ledger + consented corpus)
- [x] 17a Creator works: fingerprint, novelty-vs-resonance quadrant, lineage, catalog arc
- [x] 17b Originality Ledger: attestation, machine-use terms, pack manifest enforcement, attribution receipts
- [x] 17c Corpus opt-in, brief matching, creator dashboard

## Follow-up (ingest)
- [ ] Replace worker.py LIMIT/OFFSET reads with a single streaming DuckDB cursor (quadratic re-scan is why giant files crawl)
- [ ] Watch the Step 2 replay of the 7 giant CTV/web files and report when they close out
- [ ] Surface Ensemble archetype anchors ("in the lineage of…") in every fingerprint surface: uploaded/Spotify analyses and Intuizi meta-signal cohorts
- [x] Fix preview typecheck build errors (ConsumerDoor analyze-audio response shape)
