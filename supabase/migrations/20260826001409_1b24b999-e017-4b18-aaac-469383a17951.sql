DROP POLICY IF EXISTS "Org writers can create category profiles" ON public.org_category_profiles;
DROP POLICY IF EXISTS "Org writers can update category profiles" ON public.org_category_profiles;

CREATE POLICY "Org owners can create category profiles"
ON public.org_category_profiles
FOR INSERT
TO authenticated
WITH CHECK (public.is_org_owner(organization_id));

CREATE POLICY "Org owners can update category profiles"
ON public.org_category_profiles
FOR UPDATE
TO authenticated
USING (public.is_org_owner(organization_id))
WITH CHECK (public.is_org_owner(organization_id));