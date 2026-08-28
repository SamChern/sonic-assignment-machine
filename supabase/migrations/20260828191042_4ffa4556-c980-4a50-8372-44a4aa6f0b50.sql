CREATE OR REPLACE FUNCTION public.org_cohort_aggregates(_org uuid)
RETURNS TABLE (
  cohort_id uuid,
  slug text,
  name text,
  description text,
  member_count integer,
  narrative text,
  export_eligible boolean,
  last_exported_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT c.id,
         c.slug,
         c.name,
         c.description,
         c.member_count,
         c.narrative,
         c.export_eligible,
         max(e.created_at) AS last_exported_at
  FROM public.sonic_cohorts c
  JOIN public.sonic_cohort_exports e ON e.cohort_id = c.id
  WHERE e.organization_id = _org
    AND (public.has_org_access(_org) OR public.has_role(auth.uid(), 'admin'))
  GROUP BY c.id, c.slug, c.name, c.description, c.member_count, c.narrative, c.export_eligible;
$$;

REVOKE ALL ON FUNCTION public.org_cohort_aggregates(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.org_cohort_aggregates(uuid) TO authenticated, service_role;