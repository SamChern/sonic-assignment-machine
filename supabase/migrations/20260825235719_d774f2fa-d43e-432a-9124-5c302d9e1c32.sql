CREATE TABLE public.org_tracking_settings (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  google_tag_id text,
  google_ads_conversion_id text,
  google_ads_conversion_label text,
  meta_pixel_id text,
  tiktok_pixel_id text,
  notes text,
  updated_by uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE (organization_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.org_tracking_settings TO authenticated;
GRANT ALL ON public.org_tracking_settings TO service_role;

ALTER TABLE public.org_tracking_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members can view tracking settings"
ON public.org_tracking_settings FOR SELECT TO authenticated
USING (public.has_org_access(organization_id));

CREATE POLICY "Org writers can insert tracking settings"
ON public.org_tracking_settings FOR INSERT TO authenticated
WITH CHECK (public.has_org_write(organization_id));

CREATE POLICY "Org writers can update tracking settings"
ON public.org_tracking_settings FOR UPDATE TO authenticated
USING (public.has_org_write(organization_id))
WITH CHECK (public.has_org_write(organization_id));

CREATE POLICY "Org owners can delete tracking settings"
ON public.org_tracking_settings FOR DELETE TO authenticated
USING (public.is_org_owner(organization_id));