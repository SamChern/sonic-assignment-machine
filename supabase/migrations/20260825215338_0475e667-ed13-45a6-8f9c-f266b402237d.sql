CREATE TABLE public.org_category_profiles (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  version integer NOT NULL,
  name text NOT NULL,
  notes text,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_active boolean NOT NULL DEFAULT false,
  created_by uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE (organization_id, version)
);

CREATE UNIQUE INDEX org_category_profiles_one_active
  ON public.org_category_profiles (organization_id)
  WHERE is_active;

CREATE INDEX org_category_profiles_org_idx
  ON public.org_category_profiles (organization_id, version DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.org_category_profiles TO authenticated;
GRANT ALL ON public.org_category_profiles TO service_role;

ALTER TABLE public.org_category_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members can view category profiles"
  ON public.org_category_profiles FOR SELECT TO authenticated
  USING (public.has_org_access(organization_id));

CREATE POLICY "Org writers can create category profiles"
  ON public.org_category_profiles FOR INSERT TO authenticated
  WITH CHECK (public.has_org_write(organization_id));

CREATE POLICY "Org writers can update category profiles"
  ON public.org_category_profiles FOR UPDATE TO authenticated
  USING (public.has_org_write(organization_id))
  WITH CHECK (public.has_org_write(organization_id));

CREATE POLICY "Org owners can delete category profiles"
  ON public.org_category_profiles FOR DELETE TO authenticated
  USING (public.is_org_owner(organization_id));

CREATE TRIGGER trg_org_category_profiles_updated
  BEFORE UPDATE ON public.org_category_profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();