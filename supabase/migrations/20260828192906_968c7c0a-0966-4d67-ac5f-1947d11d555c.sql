-- 1. pixel_events: gclid / UTM / consent capture
ALTER TABLE public.pixel_events
  ADD COLUMN IF NOT EXISTS gclid text,
  ADD COLUMN IF NOT EXISTS utm_source text,
  ADD COLUMN IF NOT EXISTS utm_medium text,
  ADD COLUMN IF NOT EXISTS utm_campaign text,
  ADD COLUMN IF NOT EXISTS utm_term text,
  ADD COLUMN IF NOT EXISTS utm_content text,
  ADD COLUMN IF NOT EXISTS consent jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS pixel_events_org_gclid_idx
  ON public.pixel_events (organization_id, gclid) WHERE gclid IS NOT NULL;

-- 2. holdout slice on cohort membership
ALTER TABLE public.sonic_cohort_members
  ADD COLUMN IF NOT EXISTS holdout boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS sonic_cohort_members_holdout_idx
  ON public.sonic_cohort_members (cohort_id, holdout);

-- 3. per-axis outcome lift priors (closes the score -> activate -> measure loop)
CREATE TABLE IF NOT EXISTS public.category_outcome_priors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  cohort_slug text,
  kpi text NOT NULL,
  category text NOT NULL,
  lift numeric NOT NULL DEFAULT 0,
  ci_low numeric,
  ci_high numeric,
  exposed_n integer NOT NULL DEFAULT 0,
  holdout_n integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS category_outcome_priors_key_idx
  ON public.category_outcome_priors (organization_id, coalesce(cohort_slug, ''), kpi, category);

GRANT SELECT ON public.category_outcome_priors TO authenticated;
GRANT ALL ON public.category_outcome_priors TO service_role;
ALTER TABLE public.category_outcome_priors ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Org members read outcome priors" ON public.category_outcome_priors;
CREATE POLICY "Org members read outcome priors"
  ON public.category_outcome_priors FOR SELECT TO authenticated
  USING (public.has_org_access(organization_id));

-- 4. Control Room knobs
INSERT INTO public.control_registry (key, value, value_type, bounds, description, category)
VALUES
  ('predict.min_kpi_rows', '24'::jsonb, 'number', '{"min":8,"max":500}'::jsonb,
   'Minimum scored rows with a KPI value before category-level outcome claims are shown.', 'predict'),
  ('predict.bootstrap_iters', '200'::jsonb, 'number', '{"min":50,"max":2000}'::jsonb,
   'Bootstrap resamples used for outcome confidence intervals.', 'predict'),
  ('predict.knn_k', '300'::jsonb, 'number', '{"min":25,"max":2000}'::jsonb,
   'Neighbours retrieved from the embedding store before slider re-weighting.', 'predict'),
  ('predict.min_similarity', '0.55'::jsonb, 'number', '{"min":0,"max":1}'::jsonb,
   'Default similarity floor on the reach-resonance curve.', 'predict'),
  ('activation.holdout_pct', '0.10'::jsonb, 'number', '{"min":0,"max":0.5}'::jsonb,
   'Share of each cohort withheld from activation files to measure lift.', 'activation')
ON CONFLICT (key) DO NOTHING;

-- 5. nearest taxonomy nodes for brief-to-profile seeding
CREATE OR REPLACE FUNCTION public.match_taxonomy_nodes(
  query_embedding vector(1536),
  match_count int DEFAULT 12,
  code_prefix text DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  code text,
  label text,
  similarity float
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT t.id, t.code, t.label,
         1 - (t.embedding <=> query_embedding) AS similarity
  FROM public.taxonomy_nodes t
  WHERE t.embedding IS NOT NULL
    AND t.suppressed = false
    AND (code_prefix IS NULL OR t.code LIKE code_prefix || '%')
  ORDER BY t.embedding <=> query_embedding
  LIMIT match_count;
$$;

REVOKE ALL ON FUNCTION public.match_taxonomy_nodes(vector, int, text) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.match_taxonomy_nodes(vector, int, text) TO authenticated, service_role;