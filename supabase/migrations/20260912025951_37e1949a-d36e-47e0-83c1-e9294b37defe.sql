CREATE TABLE public.org_capabilities (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID NOT NULL UNIQUE REFERENCES public.organizations(id) ON DELETE CASCADE,
  intuizi_console BOOLEAN NOT NULL DEFAULT true,
  semantic_model BOOLEAN NOT NULL DEFAULT true,
  clap_grounding BOOLEAN NOT NULL DEFAULT true,
  eid_enrichment BOOLEAN NOT NULL DEFAULT true,
  pixels_tracking BOOLEAN NOT NULL DEFAULT true,
  predict_users BOOLEAN NOT NULL DEFAULT true,
  predict_outcomes BOOLEAN NOT NULL DEFAULT true,
  enrichment_preview BOOLEAN NOT NULL DEFAULT true,
  notes TEXT,
  updated_by UUID,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

GRANT SELECT ON public.org_capabilities TO authenticated;
GRANT ALL ON public.org_capabilities TO service_role;

ALTER TABLE public.org_capabilities ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view their org capabilities"
ON public.org_capabilities FOR SELECT TO authenticated
USING (public.has_org_access(organization_id) OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins manage org capabilities"
ON public.org_capabilities FOR ALL TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER update_org_capabilities_updated_at
BEFORE UPDATE ON public.org_capabilities
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();