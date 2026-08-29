GRANT SELECT ON public.embedding_bridges TO authenticated;
GRANT SELECT ON public.sonic_cohorts TO authenticated;
GRANT ALL ON public.embedding_bridges TO service_role;
GRANT ALL ON public.sonic_cohorts TO service_role;
GRANT ALL ON public.sonic_cohort_members TO service_role;