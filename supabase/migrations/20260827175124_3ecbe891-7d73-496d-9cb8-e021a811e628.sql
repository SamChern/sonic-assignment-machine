CREATE TABLE public.org_intuizi_sync_runs (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  activation_id text NOT NULL,
  dataset_id uuid,
  started_by uuid,
  status text NOT NULL DEFAULT 'running',
  profiles_found integer NOT NULL DEFAULT 0,
  rows_synced integer NOT NULL DEFAULT 0,
  rows_scored integer NOT NULL DEFAULT 0,
  rows_failed integer NOT NULL DEFAULT 0,
  coverage_pct numeric,
  error text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  started_at timestamp with time zone NOT NULL DEFAULT now(),
  finished_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

GRANT SELECT ON public.org_intuizi_sync_runs TO authenticated;
GRANT ALL ON public.org_intuizi_sync_runs TO service_role;

ALTER TABLE public.org_intuizi_sync_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members can view their sync history"
ON public.org_intuizi_sync_runs
FOR SELECT
TO authenticated
USING (public.has_org_access(organization_id));

CREATE POLICY "Admins can manage sync history"
ON public.org_intuizi_sync_runs
FOR ALL
TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER trg_org_intuizi_sync_runs_updated
BEFORE UPDATE ON public.org_intuizi_sync_runs
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_org_intuizi_sync_runs_org_activation
ON public.org_intuizi_sync_runs(organization_id, activation_id, started_at DESC);