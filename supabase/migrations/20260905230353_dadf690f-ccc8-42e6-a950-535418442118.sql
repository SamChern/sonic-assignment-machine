
-- ============ Batch E: next-level foundations (admin-only, flag-gated) ============

CREATE TABLE public.resonance_definitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version text NOT NULL UNIQUE,
  weights jsonb NOT NULL,
  distance_shape text NOT NULL DEFAULT 'euclidean',
  notes text,
  is_active boolean NOT NULL DEFAULT false,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.resonance_definitions TO authenticated;
GRANT ALL ON public.resonance_definitions TO service_role;
ALTER TABLE public.resonance_definitions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage resonance definitions" ON public.resonance_definitions
  FOR ALL TO authenticated USING (has_role(auth.uid(),'admin')) WITH CHECK (has_role(auth.uid(),'admin'));

INSERT INTO public.resonance_definitions (version, weights, distance_shape, notes, is_active)
VALUES ('v1', '{"emotional":1,"cognitive":1,"social":1,"communication":1,"contextual":1.25,"artistic":0.75}'::jsonb,
        'euclidean',
        'Resonance Point v1 — one auditable per-impression score from the six-axis distance between content and audience, normalised to 0-100 and validated against the holdout-lift loop.',
        true);

CREATE TABLE public.commons_pool_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  catalog_item_id uuid,
  audio_source_id uuid,
  title text NOT NULL,
  rights_holder text,
  status text NOT NULL DEFAULT 'proposed',
  governance_notes text,
  included_at timestamptz,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.commons_pool_items TO authenticated;
GRANT ALL ON public.commons_pool_items TO service_role;
ALTER TABLE public.commons_pool_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage commons pool" ON public.commons_pool_items
  FOR ALL TO authenticated USING (has_role(auth.uid(),'admin')) WITH CHECK (has_role(auth.uid(),'admin'));

CREATE TABLE public.commons_license_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pool_item_id uuid NOT NULL REFERENCES public.commons_pool_items(id) ON DELETE CASCADE,
  license text NOT NULL,
  rights_holder text,
  terms_url text,
  attribution text,
  verified_by uuid,
  verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.commons_license_ledger TO authenticated;
GRANT ALL ON public.commons_license_ledger TO service_role;
ALTER TABLE public.commons_license_ledger ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage commons ledger" ON public.commons_license_ledger
  FOR ALL TO authenticated USING (has_role(auth.uid(),'admin')) WITH CHECK (has_role(auth.uid(),'admin'));
CREATE INDEX commons_license_ledger_item_idx ON public.commons_license_ledger(pool_item_id);

CREATE TABLE public.commons_payouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pool_item_id uuid NOT NULL REFERENCES public.commons_pool_items(id) ON DELETE CASCADE,
  period_start date NOT NULL,
  period_end date NOT NULL,
  inclusions integer NOT NULL DEFAULT 0,
  amount_usd numeric(12,4) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.commons_payouts TO authenticated;
GRANT ALL ON public.commons_payouts TO service_role;
ALTER TABLE public.commons_payouts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage commons payouts" ON public.commons_payouts
  FOR ALL TO authenticated USING (has_role(auth.uid(),'admin')) WITH CHECK (has_role(auth.uid(),'admin'));
CREATE INDEX commons_payouts_item_idx ON public.commons_payouts(pool_item_id, period_start DESC);

CREATE TABLE public.hear_api_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label text NOT NULL,
  key_hash text NOT NULL UNIQUE,
  key_prefix text NOT NULL,
  scopes text[] NOT NULL DEFAULT ARRAY['hear'],
  created_by uuid,
  last_used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.hear_api_keys TO authenticated;
GRANT ALL ON public.hear_api_keys TO service_role;
ALTER TABLE public.hear_api_keys ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage hear keys" ON public.hear_api_keys
  FOR ALL TO authenticated USING (has_role(auth.uid(),'admin')) WITH CHECK (has_role(auth.uid(),'admin'));

CREATE TABLE public.frame_embeddings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  taxonomy_code text,
  grounding_asset_id uuid,
  audio_source_id uuid,
  frame_ms integer NOT NULL DEFAULT 0,
  storage_path text,
  embedding jsonb,
  embedding_space text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.frame_embeddings TO authenticated;
GRANT ALL ON public.frame_embeddings TO service_role;
ALTER TABLE public.frame_embeddings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage frame embeddings" ON public.frame_embeddings
  FOR ALL TO authenticated USING (has_role(auth.uid(),'admin')) WITH CHECK (has_role(auth.uid(),'admin'));
CREATE INDEX frame_embeddings_code_idx ON public.frame_embeddings(taxonomy_code);

CREATE TABLE public.sonic_passports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_hash text NOT NULL,
  user_id uuid,
  payload jsonb NOT NULL,
  signature text NOT NULL,
  consent_scopes text[] NOT NULL DEFAULT ARRAY[]::text[],
  issued_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sonic_passports TO authenticated;
GRANT ALL ON public.sonic_passports TO service_role;
ALTER TABLE public.sonic_passports ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage passports" ON public.sonic_passports
  FOR ALL TO authenticated USING (has_role(auth.uid(),'admin')) WITH CHECK (has_role(auth.uid(),'admin'));
CREATE INDEX sonic_passports_subject_idx ON public.sonic_passports(subject_hash);

CREATE TABLE public.venue_contexts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  place_id text,
  poi_codes text[] NOT NULL DEFAULT ARRAY[]::text[],
  context_vector jsonb,
  cohort_ids uuid[] NOT NULL DEFAULT ARRAY[]::uuid[],
  status text NOT NULL DEFAULT 'draft',
  notes text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.venue_contexts TO authenticated;
GRANT ALL ON public.venue_contexts TO service_role;
ALTER TABLE public.venue_contexts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage venue contexts" ON public.venue_contexts
  FOR ALL TO authenticated USING (has_role(auth.uid(),'admin')) WITH CHECK (has_role(auth.uid(),'admin'));

CREATE TABLE public.learning_digests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  week_start date NOT NULL UNIQUE,
  headline text NOT NULL,
  bullets jsonb NOT NULL DEFAULT '[]'::jsonb,
  published boolean NOT NULL DEFAULT false,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.learning_digests TO authenticated;
GRANT ALL ON public.learning_digests TO service_role;
ALTER TABLE public.learning_digests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage learning digests" ON public.learning_digests
  FOR ALL TO authenticated USING (has_role(auth.uid(),'admin')) WITH CHECK (has_role(auth.uid(),'admin'));

-- Nine switches, all off: nothing below is exposed until an admin flips one.
INSERT INTO public.control_registry (key, value, value_type, category, description) VALUES
  ('nextlevel.resonance_enabled', 'false'::jsonb, 'boolean', 'nextlevel', 'Show the Resonance Index report and public methodology page.'),
  ('nextlevel.commons_enabled', 'false'::jsonb, 'boolean', 'nextlevel', 'Enable the governed Sonic Commons pool.'),
  ('nextlevel.ondevice_enabled', 'false'::jsonb, 'boolean', 'nextlevel', 'Score tags in the browser instead of calling the model.'),
  ('nextlevel.hear_api_enabled', 'false'::jsonb, 'boolean', 'nextlevel', 'Expose hear() to other models via the agent tools.'),
  ('nextlevel.frames_enabled', 'false'::jsonb, 'boolean', 'nextlevel', 'Align sampled image frames with audio vectors.'),
  ('nextlevel.passport_enabled', 'false'::jsonb, 'boolean', 'nextlevel', 'Allow Sonic Passport issue/verify outside admin.'),
  ('nextlevel.sensory_enabled', 'false'::jsonb, 'boolean', 'nextlevel', 'Show vibration and light patterns beside the :03 signature.'),
  ('nextlevel.livecontext_enabled', 'false'::jsonb, 'boolean', 'nextlevel', 'Score the ambient sonic context of a place.'),
  ('nextlevel.learning_public', 'false'::jsonb, 'boolean', 'nextlevel', 'Publish "what SONICSIM learned this week" publicly.')
ON CONFLICT (key) DO NOTHING;
