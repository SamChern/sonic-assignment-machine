CREATE TABLE public.org_intuizi_activations (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  activation_id text NOT NULL,
  label text,
  notes text,
  is_active boolean NOT NULL DEFAULT true,
  last_synced_at timestamp with time zone,
  granted_by uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE (organization_id, activation_id)
);

GRANT SELECT ON public.org_intuizi_activations TO authenticated;
GRANT ALL ON public.org_intuizi_activations TO service_role;

ALTER TABLE public.org_intuizi_activations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members can view their granted activations"
ON public.org_intuizi_activations
FOR SELECT
TO authenticated
USING (public.has_org_access(organization_id));

CREATE POLICY "Admins can manage activation grants"
ON public.org_intuizi_activations
FOR ALL
TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER trg_org_intuizi_activations_updated
BEFORE UPDATE ON public.org_intuizi_activations
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_org_intuizi_activations_org ON public.org_intuizi_activations(organization_id) WHERE is_active;