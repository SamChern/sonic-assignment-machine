CREATE TABLE public.admin_guide_entries (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  slug text NOT NULL UNIQUE,
  title text NOT NULL,
  kind text NOT NULL DEFAULT 'glossary',
  category text NOT NULL DEFAULT 'General',
  body text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'live',
  version text,
  related_routes text[] NOT NULL DEFAULT '{}',
  related_functions text[] NOT NULL DEFAULT '{}',
  verify_note text,
  sort_order integer NOT NULL DEFAULT 100,
  archived boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.admin_guide_entries TO authenticated;
GRANT ALL ON public.admin_guide_entries TO service_role;

ALTER TABLE public.admin_guide_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins read guide" ON public.admin_guide_entries
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins insert guide" ON public.admin_guide_entries
  FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins update guide" ON public.admin_guide_entries
  FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins delete guide" ON public.admin_guide_entries
  FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'));

CREATE OR REPLACE FUNCTION public.touch_admin_guide_entries()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_touch_admin_guide_entries
  BEFORE UPDATE ON public.admin_guide_entries
  FOR EACH ROW EXECUTE FUNCTION public.touch_admin_guide_entries();

CREATE INDEX idx_admin_guide_entries_kind ON public.admin_guide_entries (kind, sort_order);

INSERT INTO public.admin_guide_entries (slug, title, kind, category, status, sort_order, body) VALUES
('six-axis-ontology', 'Six-axis ontology', 'glossary', 'Scoring', 'live', 10, 'Every sonic subject is scored on six axes: Emotional, Cognitive, Social, Communication, Contextual, Artistic. Scores are 0-100 and relative to the population, not absolute.'),
('score-normalization', 'Score normalization (z-score to percentile)', 'glossary', 'Scoring', 'live', 20, 'Raw model output is converted to a population percentile using running mean and standard deviation held in `category_calibration` (Welford updates). This is why a score of 50 means "typical", not "mediocre".'),
('grounding-level', 'Grounding level', 'glossary', 'Scoring', 'live', 30, 'How much real sound backed a score: `text-only` (tags/metadata only), `bridged` (text embedding bridged into the audio space), `grounded` (a sound-grounded embedding from a published pack). Surfaced in the UI by the Grounding badge.'),
('grounding-pack', 'Grounding pack', 'glossary', 'Sound Library', 'live', 40, 'A versioned bundle of licensed audio clips and their embeddings that anchors the taxonomy in real sound. Built and published from the Sound Library; each build records a manifest of what it included.'),
('archetype', 'Ensemble archetype', 'glossary', 'Signatures', 'live', 50, 'A named region of the six-axis space (e.g. The Torchbearer). Assignment is stable across re-scores and gives an analysis its plain-language anchor: "in the lineage of...".'),
('sonic-signature', 'Sonic signature', 'glossary', 'Signatures', 'live', 60, 'A deterministic ~3.5s audio rendering of a fingerprint. The same subject always renders byte-identical audio.'),
('eid-subject-key', 'EID / subject key', 'glossary', 'Privacy', 'live', 70, 'The Intuizi enterprise identifier, used verbatim as the subject join key. EIDs are join keys only: never model features, never embedded, never logged. Any table holding a `subject_key` is service-role/admin only.'),
('cohort-activation', 'Cohort and Activation file', 'glossary', 'Cohorts', 'live', 80, 'A cohort is a clustered set of subjects with a shared sonic profile. Export produces an Activation file (one uppercase 32-hex EID per row) in the S3 `outbound/` prefix. Cohorts under 1,000 members refuse export.'),
('persona-doors', 'Personas (four doors, one house)', 'glossary', 'Personas', 'live', 90, 'A view preference stored on `profiles.persona`: curious (consumer), marketing (enterprise), creator, plus admin by role. Personas change framing only - every permission check still runs on app_role / org_role.'),
('confidence-chip', 'Confidence chip', 'glossary', 'Enterprise', 'planned', 100, 'One chip per enterprise result collapsing grounding level, sample sufficiency and confidence-interval width into High / Moderate / Not yet distinguishable, expandable to the underlying detail.'),
('control-registry', 'Control Room knobs', 'glossary', 'Operations', 'live', 110, 'All pipeline tunables live in `control_registry` and are read by edge functions with a 60s in-memory cache, so a change takes effect without a redeploy. Every change is audited in `control_audit` and one-click revertible.'),
('originality-ledger', 'Originality Ledger', 'glossary', 'Creator', 'planned', 120, 'Append-only record of a registered work: a content-derived fingerprint (never the audio), the creator rights attestation and machine-use terms. Terms are enforced in the pack build and asserted in the manifest.'),
('retention-90d', '90-day retention mirror', 'glossary', 'Privacy', 'live', 130, 'A nightly job purges Intuizi-derived subject data older than 90 days and runs a custody scan. Retention state is visible on the EC2 & compliance page.');

INSERT INTO public.admin_guide_entries (slug, title, kind, category, status, sort_order, related_routes, related_functions, verify_note, body) VALUES
('step-1-schema', 'Step 1 - Schema spine', 'runbook', 'Foundation', 'live', 10, '{}', '{}', 'Migration applies clean; analyze-audio and intuizi-score-worker runs unaffected.', 'Additive migration: sound-grounded 512-d `audio_embedding` and crosswalk columns on `taxonomy_nodes`, plus the supporting tables. Nothing was dropped or renamed.'),
('step-2-semantic-svc', 'Step 2 - Semantic service on EC2', 'runbook', 'Infrastructure', 'live', 20, '{/admin/ec2}', '{semantic-svc-test,semantic-embed}', 'Health card green; embedding calls return in under a second.', 'Installer bundle is served from /semantic-svc/bootstrap.sh and installed on the EC2 box with gunicorn behind nginx. Status and smoke tests live on the EC2 page. The box has no GPU - embeddings only, never a local chat LLM.'),
('step-2-5-ingest', 'Step 2.5 / 2.5-alt - Ingest worker', 'runbook', 'Infrastructure', 'live', 30, '{/admin/pipeline,/admin/compatibility}', '{ingest-worker-bootstrap,ingest-worker-callback,intuizi-ingest,intuizi-score-worker}', 'Drop a test file: discovered - processing - loaded within two poll cycles; kill mid-file and the reaper returns it for clean resume.', 'HTTP-only worker leases files from the Supabase queue, streams Parquet row groups with a single DuckDB cursor, checkpoints its cursor, and reports heartbeats. Retryable stop lets a run pause and requeue without losing progress.'),
('step-3-backfill', 'Step 3 - semantic-embed + taxonomy backfill', 'runbook', 'Foundation', 'live', 40, '{/admin/semantic}', '{semantic-embed,semantic-backfill}', 'count(*) from taxonomy_nodes where audio_embedding is not null is close to node count.', 'Backfills the second embedding across the taxonomy spine and keeps an embedding cache so repeat text never re-encodes.'),
('step-4-scorer', 'Step 4 - Context-aware scorer', 'runbook', 'Scoring', 'live', 50, '{}', '{analyze-audio}', 'Re-score 50 known sources: six-axis outputs stay within calibration tolerance; a tag-only request returns scores without touching librosa.', 'analyze-audio prefers grounded embeddings and turns the kNN block into structured context. The request/response contract is unchanged for existing callers.'),
('step-5-crosswalk', 'Step 5 - AudioSet ontology + crosswalk', 'runbook', 'Foundation', 'live', 60, '{/admin/pipeline}', '{taxonomy-audioset-import,taxonomy-crosswalk}', 'Every iab.* node used by intuizi-ingest has at least one approved crosswalk entry.', 'AudioSet nodes imported alongside the IAB spine, with an admin review surface for proposed crosswalk pairs.'),
('step-6-cohorts', 'Step 6 - Cohorts + Activation files', 'runbook', 'Cohorts', 'live', 70, '{/admin/workbench}', '{cohort-builder,activation-export,aws-proxy}', 'A cohort under 1,000 members refuses export; an eligible one lands a well-formed file in outbound/.', 'Cohort builder clusters identifier-level signals and rolls them up into a meta fingerprint. Export writes the Activation file through aws-proxy.'),
('step-7-retention', 'Step 7 - Retention + compliance', 'runbook', 'Privacy', 'live', 80, '{/admin/ec2}', '{}', 'Seed a stale test subject; confirm full cascade deletion on the next nightly run.', 'Nightly 90-day purge with a custody scan and a compliance card that turns red when a run is overdue.'),
('step-9-control-room', 'Step 9 - Roles + Control Room', 'runbook', 'Operations', 'live', 90, '{/admin/control-room}', '{}', 'Change knn.k and watch the next analyze-audio call use it with no deploy; revert restores it; an enterprise viewer can query cohorts but never a subject_key.', 'Three-tier app_role plus org_role, with every pipeline tunable in control_registry and a full audit trail.'),
('step-10-scope', 'Step 10 - The Scope', 'runbook', 'Visualization', 'live', 100, '{/,/workspace}', '{scope-window-score}', 'Play a known track - tags fire in plausible places and the radial matches stored scores; a tag-only subject renders a stable silhouette.', 'Audioscope visuals with three lenses, transport controls, node pulsing and keyboard shortcuts. Consumers see no debug drawer.'),
('step-11-predict', 'Step 11 - Predict loop', 'runbook', 'Enterprise', 'live', 110, '{/workspace}', '{predict-users,predict-outcomes,activation-lift,scoring-regression}', 'A nonsense brief still yields a bounded profile; with a tiny KPI dataset the outcomes panel refuses category claims; an activation run produces a holdout and a lift number.', 'Closed loop: kNN ranking base, slider re-weighting, deterministic holdout splits and ridge regression against real outcomes.'),
('step-12-consolidation', 'Step 12 - Front-end consolidation', 'runbook', 'Frontend', 'live', 120, '{}', '{}', 'Route inventory unchanged except consolidations; preferences follow the user across browsers; bundle-size check passes; no touched component over ~500 lines.', 'Unified D3 renderer, shared graph engine, cross-device UI preferences on profiles.ui_prefs, and a bundle-size guard in CI.'),
('step-13-resolver', 'Step 13 - The Resolver', 'runbook', 'Foundation', 'live', 130, '{/admin/pipeline}', '{signal-resolver}', 'Seed a fake unknown channel name; the nightly run produces a described, embedded, unreviewed node with crosswalk proposals; the budget cap halts an oversized queue with a logged partial state.', 'Agent-driven open-web resolution of unknown symbols, with a review queue and a hard budget cap.'),
('step-14-sound-library', 'Step 14 - Sound Library', 'runbook', 'Sound Library', 'live', 140, '{/admin/sound-library}', '{sound-curator}', 'With the stub pack, results show text-only badges; after loading a real pack, coverage meters move and badges flip to grounded.', 'Coverage meters, gap curation with AI-proposed clips, a license-preserving review queue and versioned pack publishing.'),
('step-15-signatures', 'Step 15 - Sonic Signatures + Ensemble', 'runbook', 'Signatures', 'live', 150, '{/,/workspace}', '{signature-render}', 'The same subject renders byte-identical signature audio twice; archetype assignment is stable across re-scores.', 'Seeded Ensemble archetypes and a deterministic signature renderer, surfaced with anchors on every fingerprint view.'),
('step-16-0-personas', 'Step 16.0 - Persona plumbing', 'runbook', 'Personas', 'live', 160, '{/}', '{}', 'First visit shows the chooser once; admins skip it; the door switcher round-trips.', 'profiles.persona, the one-question chooser, the avatar-menu door switcher and per-persona default landing.'),
('step-16a-consumer', 'Step 16a - Consumer door', 'runbook', 'Personas', 'live', 170, '{/}', '{}', 'A first-time visitor reaches a played signature in under 20 seconds with no signup.', 'One universal input (search, file, link, or plain words), one result view, one disclosure expander, share permalink, cohort ladder and a free-tier quota.'),
('step-16b-enterprise', 'Step 16b - Enterprise door', 'runbook', 'Enterprise', 'planned', 180, '{/workspace}', '{client-narrative,onepager-export}', 'An enterprise viewer can save and re-run a Playbook.', 'Three job cards, the brief box, the Confidence chip, Playbooks, client workspaces, one-pager and CSV export, and the "explain this to my client" narrative.'),
('step-16c-admin', 'Step 16c - Admin door', 'runbook', 'Operations', 'planned', 190, '{/admin}', '{}', 'Command palette finds a cohort by name; preview-as-role leaks no admin affordances.', 'Glance / Operate / Diagnose depth toggle, a command palette, the "what changed since yesterday" digest and preview-as-role.'),
('step-17-creator', 'Step 17 - Creator door', 'runbook', 'Creator', 'planned', 200, '{/creator}', '{creator-register,brief-match}', 'A no-training work never appears in a built pack manifest; withdrawal excludes it from the next build with a recorded date; a creator sees only their own works.', 'Understand (divergence with coherence, lineage, catalog arc), Register (Originality Ledger and machine-use terms) and Monetize (consented corpus, brief matching, earnings dashboard).');