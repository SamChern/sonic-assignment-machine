CREATE TABLE public.sonic_cohort_exports (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  cohort_id uuid REFERENCES public.sonic_cohorts(id) ON DELETE SET NULL,
  cohort_slug text NOT NULL,
  organization_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL,
  activation_id text,
  object_key text,
  dt date NOT NULL DEFAULT (now()::date),
  row_count integer NOT NULL DEFAULT 0,
  bytes integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending',
  error text,
  started_by uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX sonic_cohort_exports_cohort_idx ON public.sonic_cohort_exports (cohort_slug, created_at DESC);

GRANT SELECT ON public.sonic_cohort_exports TO authenticated;
GRANT ALL ON public.sonic_cohort_exports TO service_role;

ALTER TABLE public.sonic_cohort_exports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view cohort exports"
ON public.sonic_cohort_exports FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Org members can view their cohort exports"
ON public.sonic_cohort_exports FOR SELECT TO authenticated
USING (organization_id IS NOT NULL AND public.has_org_access(organization_id));

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_sonic_cohort_exports_updated_at
BEFORE UPDATE ON public.sonic_cohort_exports
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

GRANT SELECT ON public.sonic_cohorts TO authenticated;
GRANT ALL ON public.sonic_cohorts TO service_role;
GRANT ALL ON public.sonic_cohort_members TO service_role;