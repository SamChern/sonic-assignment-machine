-- ============ 16.0 persona ============
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS persona text;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_persona_check
  CHECK (persona IS NULL OR persona IN ('curious','marketing','creator'));

-- ============ 16a share cards ============
CREATE TABLE public.share_cards (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  token text NOT NULL UNIQUE,
  user_id uuid,
  source_analysis_id uuid REFERENCES public.source_analyses(id) ON DELETE SET NULL,
  source_name text NOT NULL,
  vector jsonb NOT NULL,
  archetype_slug text REFERENCES public.sonic_archetypes(slug) ON DELETE SET NULL,
  tags jsonb NOT NULL DEFAULT '[]'::jsonb,
  narration text,
  grounding_level text NOT NULL DEFAULT 'ungrounded',
  view_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX share_cards_user_idx ON public.share_cards(user_id, created_at DESC);

GRANT SELECT ON public.share_cards TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.share_cards TO authenticated;
GRANT ALL ON public.share_cards TO service_role;

ALTER TABLE public.share_cards ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Share cards are readable by link"
  ON public.share_cards FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY "Users create their own share cards"
  ON public.share_cards FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users delete their own share cards"
  ON public.share_cards FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- ============ 16b playbooks ============
CREATE TABLE public.playbooks (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  kind text NOT NULL DEFAULT 'find_audience',
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_run_at timestamptz,
  last_run_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  run_count integer NOT NULL DEFAULT 0,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX playbooks_org_idx ON public.playbooks(organization_id, updated_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.playbooks TO authenticated;
GRANT ALL ON public.playbooks TO service_role;

ALTER TABLE public.playbooks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members read playbooks"
  ON public.playbooks FOR SELECT
  TO authenticated
  USING (public.has_org_access(organization_id) OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Org writers create playbooks"
  ON public.playbooks FOR INSERT
  TO authenticated
  WITH CHECK (public.has_org_write(organization_id));

CREATE POLICY "Org writers update playbooks"
  ON public.playbooks FOR UPDATE
  TO authenticated
  USING (public.has_org_write(organization_id))
  WITH CHECK (public.has_org_write(organization_id));

CREATE POLICY "Org writers delete playbooks"
  ON public.playbooks FOR DELETE
  TO authenticated
  USING (public.has_org_write(organization_id));

-- ============ 17 creator works ============
CREATE TABLE public.creator_works (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  title text NOT NULL,
  storage_path text,
  audio_source_id uuid REFERENCES public.audio_sources(id) ON DELETE SET NULL,
  fingerprint jsonb NOT NULL DEFAULT '{}'::jsonb,
  six_axis jsonb NOT NULL DEFAULT '{}'::jsonb,
  embedding_hash text,
  archetype_slug text REFERENCES public.sonic_archetypes(slug) ON DELETE SET NULL,
  divergence numeric,
  resonance numeric,
  rights_attested boolean NOT NULL DEFAULT false,
  machine_use_terms text NOT NULL DEFAULT 'analysis_only'
    CHECK (machine_use_terms IN ('no_training','analysis_only','licensable','public_domain')),
  corpus_opt_in boolean NOT NULL DEFAULT false,
  analysis_status text NOT NULL DEFAULT 'pending',
  analysis_error text,
  registered_at timestamptz,
  withdrawn_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX creator_works_user_idx ON public.creator_works(user_id, created_at DESC);
CREATE INDEX creator_works_terms_idx ON public.creator_works(machine_use_terms) WHERE withdrawn_at IS NULL;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.creator_works TO authenticated;
GRANT ALL ON public.creator_works TO service_role;

ALTER TABLE public.creator_works ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Creators read own works"
  ON public.creator_works FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Creators insert own works"
  ON public.creator_works FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Creators update own works"
  ON public.creator_works FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Creators delete own works"
  ON public.creator_works FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- ============ 17b originality ledger (append-only) ============
CREATE TABLE public.originality_ledger (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  work_id uuid NOT NULL REFERENCES public.creator_works(id) ON DELETE CASCADE,
  event_type text NOT NULL
    CHECK (event_type IN ('registered','terms_changed','pack_included','withdrawn','corpus_opt_in','corpus_opt_out')),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX originality_ledger_work_idx ON public.originality_ledger(work_id, created_at DESC);

GRANT SELECT ON public.originality_ledger TO authenticated;
GRANT ALL ON public.originality_ledger TO service_role;

ALTER TABLE public.originality_ledger ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Creators read own ledger events"
  ON public.originality_ledger FOR SELECT
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR EXISTS (
      SELECT 1 FROM public.creator_works w
      WHERE w.id = originality_ledger.work_id AND w.user_id = auth.uid()
    )
  );

-- ============ 17b pack inclusions ============
CREATE TABLE public.pack_inclusions (
  pack_version text NOT NULL,
  work_id uuid NOT NULL REFERENCES public.creator_works(id) ON DELETE CASCADE,
  weight numeric NOT NULL DEFAULT 1,
  analyses_influenced integer NOT NULL DEFAULT 0,
  included_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (pack_version, work_id)
);
CREATE INDEX pack_inclusions_work_idx ON public.pack_inclusions(work_id);

GRANT SELECT ON public.pack_inclusions TO authenticated;
GRANT ALL ON public.pack_inclusions TO service_role;

ALTER TABLE public.pack_inclusions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Creators read own pack inclusions"
  ON public.pack_inclusions FOR SELECT
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR EXISTS (
      SELECT 1 FROM public.creator_works w
      WHERE w.id = pack_inclusions.work_id AND w.user_id = auth.uid()
    )
  );

-- updated_at triggers
CREATE TRIGGER update_share_cards_updated_at BEFORE UPDATE ON public.share_cards
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_playbooks_updated_at BEFORE UPDATE ON public.playbooks
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_creator_works_updated_at BEFORE UPDATE ON public.creator_works
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();