-- Enterprise organizations
CREATE TYPE public.org_role AS ENUM ('owner','analyst','viewer');

CREATE TABLE public.organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  plan text NOT NULL DEFAULT 'enterprise',
  owner_user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.organizations TO authenticated;
GRANT ALL ON public.organizations TO service_role;
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.organization_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  role public.org_role NOT NULL DEFAULT 'viewer',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, user_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.organization_members TO authenticated;
GRANT ALL ON public.organization_members TO service_role;
ALTER TABLE public.organization_members ENABLE ROW LEVEL SECURITY;

-- Helpers (security definer to avoid recursive RLS)
CREATE OR REPLACE FUNCTION public.has_org_access(_org uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT _org IS NOT NULL AND (
    public.has_role(auth.uid(), 'admin')
    OR EXISTS (
      SELECT 1 FROM public.organization_members m
      WHERE m.organization_id = _org AND m.user_id = auth.uid()
    )
  )
$$;

CREATE OR REPLACE FUNCTION public.has_org_write(_org uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT _org IS NOT NULL AND (
    public.has_role(auth.uid(), 'admin')
    OR EXISTS (
      SELECT 1 FROM public.organization_members m
      WHERE m.organization_id = _org AND m.user_id = auth.uid()
        AND m.role IN ('owner','analyst')
    )
  )
$$;

CREATE OR REPLACE FUNCTION public.is_org_owner(_org uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT _org IS NOT NULL AND (
    public.has_role(auth.uid(), 'admin')
    OR EXISTS (
      SELECT 1 FROM public.organization_members m
      WHERE m.organization_id = _org AND m.user_id = auth.uid() AND m.role = 'owner'
    )
  )
$$;

CREATE POLICY "Members view their organizations" ON public.organizations
  FOR SELECT TO authenticated USING (public.has_org_access(id));
CREATE POLICY "Owners update their organization" ON public.organizations
  FOR UPDATE TO authenticated USING (public.is_org_owner(id)) WITH CHECK (public.is_org_owner(id));
CREATE POLICY "Owners delete their organization" ON public.organizations
  FOR DELETE TO authenticated USING (public.is_org_owner(id));
CREATE POLICY "Admins create organizations" ON public.organizations
  FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(),'admin'));

CREATE POLICY "Members view org membership" ON public.organization_members
  FOR SELECT TO authenticated USING (public.has_org_access(organization_id));
CREATE POLICY "Owners manage membership" ON public.organization_members
  FOR ALL TO authenticated USING (public.is_org_owner(organization_id)) WITH CHECK (public.is_org_owner(organization_id));

-- Datasets uploaded or connected by an enterprise org
CREATE TABLE public.enterprise_datasets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  source_kind text NOT NULL DEFAULT 'csv',
  row_count integer NOT NULL DEFAULT 0,
  scored_count integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'ready',
  shared boolean NOT NULL DEFAULT false,
  emotional_avg numeric,
  cognitive_avg numeric,
  social_avg numeric,
  communication_avg numeric,
  contextual_avg numeric,
  artistic_avg numeric,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.enterprise_datasets TO authenticated;
GRANT ALL ON public.enterprise_datasets TO service_role;
ALTER TABLE public.enterprise_datasets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members view org datasets" ON public.enterprise_datasets
  FOR SELECT TO authenticated USING (public.has_org_access(organization_id) OR shared = true);
CREATE POLICY "Analysts manage org datasets" ON public.enterprise_datasets
  FOR ALL TO authenticated USING (public.has_org_write(organization_id)) WITH CHECK (public.has_org_write(organization_id));

CREATE TABLE public.enterprise_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  dataset_id uuid NOT NULL REFERENCES public.enterprise_datasets(id) ON DELETE CASCADE,
  external_user_id text,
  source_name text,
  audio_url text,
  attributes jsonb NOT NULL DEFAULT '{}'::jsonb,
  kpi jsonb NOT NULL DEFAULT '{}'::jsonb,
  emotional_score numeric,
  cognitive_score numeric,
  social_score numeric,
  communication_score numeric,
  contextual_score numeric,
  artistic_score numeric,
  score_confidence numeric,
  analysis_status text NOT NULL DEFAULT 'pending',
  analysis_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_enterprise_records_dataset ON public.enterprise_records (dataset_id);
CREATE INDEX idx_enterprise_records_org ON public.enterprise_records (organization_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.enterprise_records TO authenticated;
GRANT ALL ON public.enterprise_records TO service_role;
ALTER TABLE public.enterprise_records ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members view org records" ON public.enterprise_records
  FOR SELECT TO authenticated USING (public.has_org_access(organization_id));
CREATE POLICY "Analysts manage org records" ON public.enterprise_records
  FOR ALL TO authenticated USING (public.has_org_write(organization_id)) WITH CHECK (public.has_org_write(organization_id));

CREATE TABLE public.dataset_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  provider text NOT NULL,
  name text NOT NULL,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  credential_ref text,
  status text NOT NULL DEFAULT 'configured',
  last_tested_at timestamptz,
  last_error text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.dataset_connections TO authenticated;
GRANT ALL ON public.dataset_connections TO service_role;
ALTER TABLE public.dataset_connections ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members view org connections" ON public.dataset_connections
  FOR SELECT TO authenticated USING (public.has_org_access(organization_id));
CREATE POLICY "Analysts manage org connections" ON public.dataset_connections
  FOR ALL TO authenticated USING (public.has_org_write(organization_id)) WITH CHECK (public.has_org_write(organization_id));

CREATE TABLE public.prediction_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  kind text NOT NULL,
  kpi text,
  params jsonb NOT NULL DEFAULT '{}'::jsonb,
  weights jsonb NOT NULL DEFAULT '{}'::jsonb,
  result jsonb,
  status text NOT NULL DEFAULT 'done',
  error text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.prediction_runs TO authenticated;
GRANT ALL ON public.prediction_runs TO service_role;
ALTER TABLE public.prediction_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members view org predictions" ON public.prediction_runs
  FOR SELECT TO authenticated USING (public.has_org_access(organization_id));
CREATE POLICY "Analysts manage org predictions" ON public.prediction_runs
  FOR ALL TO authenticated USING (public.has_org_write(organization_id)) WITH CHECK (public.has_org_write(organization_id));

CREATE TABLE public.pixel_tags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  tag_id text NOT NULL UNIQUE,
  name text NOT NULL DEFAULT 'Primary site',
  allowed_origins text[] NOT NULL DEFAULT '{}',
  active boolean NOT NULL DEFAULT true,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pixel_tags TO authenticated;
GRANT ALL ON public.pixel_tags TO service_role;
ALTER TABLE public.pixel_tags ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members view org tags" ON public.pixel_tags
  FOR SELECT TO authenticated USING (public.has_org_access(organization_id));
CREATE POLICY "Analysts manage org tags" ON public.pixel_tags
  FOR ALL TO authenticated USING (public.has_org_write(organization_id)) WITH CHECK (public.has_org_write(organization_id));

CREATE TABLE public.pixel_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  tag_id text NOT NULL,
  event_name text NOT NULL,
  external_user_id text,
  page_url text,
  referrer text,
  kpi_metric text,
  kpi_value numeric,
  props jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_pixel_events_org_time ON public.pixel_events (organization_id, occurred_at DESC);
GRANT SELECT ON public.pixel_events TO authenticated;
GRANT ALL ON public.pixel_events TO service_role;
ALTER TABLE public.pixel_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members view org pixel events" ON public.pixel_events
  FOR SELECT TO authenticated USING (public.has_org_access(organization_id));

-- Stamp existing analysis data with an optional organization
ALTER TABLE public.source_analyses ADD COLUMN organization_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL;
ALTER TABLE public.audio_sources ADD COLUMN organization_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL;
CREATE INDEX idx_source_analyses_org ON public.source_analyses (organization_id);
CREATE INDEX idx_audio_sources_org ON public.audio_sources (organization_id);

-- updated_at triggers
CREATE TRIGGER trg_organizations_updated BEFORE UPDATE ON public.organizations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_org_members_updated BEFORE UPDATE ON public.organization_members
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_enterprise_datasets_updated BEFORE UPDATE ON public.enterprise_datasets
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_enterprise_records_updated BEFORE UPDATE ON public.enterprise_records
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_dataset_connections_updated BEFORE UPDATE ON public.dataset_connections
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_prediction_runs_updated BEFORE UPDATE ON public.prediction_runs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_pixel_tags_updated BEFORE UPDATE ON public.pixel_tags
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();