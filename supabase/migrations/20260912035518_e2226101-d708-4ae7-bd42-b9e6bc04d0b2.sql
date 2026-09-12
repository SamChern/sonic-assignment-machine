CREATE TABLE public.org_scoring_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  dataset_id uuid REFERENCES public.enterprise_datasets(id) ON DELETE SET NULL,
  trigger_source text NOT NULL DEFAULT 'manual',
  status text NOT NULL DEFAULT 'running',
  datasets_touched integer NOT NULL DEFAULT 0,
  processed integer NOT NULL DEFAULT 0,
  scored integer NOT NULL DEFAULT 0,
  unresolved integer NOT NULL DEFAULT 0,
  avg_confidence numeric,
  error text,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.org_scoring_runs TO authenticated;
GRANT ALL ON public.org_scoring_runs TO service_role;

ALTER TABLE public.org_scoring_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view their organization's scoring runs"
  ON public.org_scoring_runs FOR SELECT TO authenticated
  USING (public.has_org_access(organization_id));

CREATE INDEX idx_org_scoring_runs_org_started
  ON public.org_scoring_runs (organization_id, started_at DESC);

CREATE INDEX idx_org_scoring_runs_status
  ON public.org_scoring_runs (status, started_at DESC);

CREATE TRIGGER org_scoring_runs_updated_at
  BEFORE UPDATE ON public.org_scoring_runs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Enterprise records already carry per-row status and confidence; this reads
-- them back for one organization so the workspace shows numbers that come from
-- the account's own feeds, not the platform-wide population.
CREATE OR REPLACE FUNCTION public.org_own_data_confidence(_organization_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_totals jsonb;
  v_datasets jsonb;
  v_last jsonb;
BEGIN
  IF _organization_id IS NULL THEN
    RAISE EXCEPTION 'organization_id is required';
  END IF;
  IF NOT (public.has_org_access(_organization_id) OR public.has_role(auth.uid(), 'admin')) THEN
    RAISE EXCEPTION 'Not authorized for this organization';
  END IF;

  SELECT jsonb_build_object(
           'rows_total', count(*),
           'rows_scored', count(*) FILTER (WHERE analysis_status = 'scored'),
           'rows_pending', count(*) FILTER (WHERE analysis_status = 'pending'),
           'rows_unresolved', count(*) FILTER (WHERE analysis_status = 'unresolved'),
           'avg_confidence', round(avg(score_confidence) FILTER (WHERE analysis_status = 'scored')::numeric, 4),
           'avg_scores', jsonb_build_object(
             'emotional', round(avg(emotional_score) FILTER (WHERE analysis_status = 'scored')::numeric, 1),
             'cognitive', round(avg(cognitive_score) FILTER (WHERE analysis_status = 'scored')::numeric, 1),
             'social', round(avg(social_score) FILTER (WHERE analysis_status = 'scored')::numeric, 1),
             'communication', round(avg(communication_score) FILTER (WHERE analysis_status = 'scored')::numeric, 1),
             'contextual', round(avg(contextual_score) FILTER (WHERE analysis_status = 'scored')::numeric, 1),
             'artistic', round(avg(artistic_score) FILTER (WHERE analysis_status = 'scored')::numeric, 1)
           )
         )
    INTO v_totals
    FROM public.enterprise_records
   WHERE organization_id = _organization_id;

  SELECT coalesce(jsonb_agg(d ORDER BY (d->>'rows_total')::bigint DESC), '[]'::jsonb)
    INTO v_datasets
    FROM (
      SELECT jsonb_build_object(
               'dataset_id', ds.id,
               'name', ds.name,
               'rows_total', count(r.id),
               'rows_scored', count(r.id) FILTER (WHERE r.analysis_status = 'scored'),
               'rows_pending', count(r.id) FILTER (WHERE r.analysis_status = 'pending'),
               'rows_unresolved', count(r.id) FILTER (WHERE r.analysis_status = 'unresolved'),
               'avg_confidence', round(avg(r.score_confidence) FILTER (WHERE r.analysis_status = 'scored')::numeric, 4)
             ) AS d
        FROM public.enterprise_datasets ds
        LEFT JOIN public.enterprise_records r ON r.dataset_id = ds.id
       WHERE ds.organization_id = _organization_id
       GROUP BY ds.id, ds.name
       LIMIT 50
    ) s;

  SELECT to_jsonb(x) INTO v_last
    FROM (
      SELECT id, dataset_id, trigger_source, status, processed, scored, unresolved,
             datasets_touched, avg_confidence, error, started_at, finished_at
        FROM public.org_scoring_runs
       WHERE organization_id = _organization_id
       ORDER BY started_at DESC
       LIMIT 1
    ) x;

  RETURN jsonb_build_object(
    'organization_id', _organization_id,
    'totals', coalesce(v_totals, '{}'::jsonb),
    'datasets', v_datasets,
    'last_run', v_last,
    'computed_at', now()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.org_own_data_confidence(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.org_own_data_confidence(uuid) TO authenticated, service_role;

CREATE INDEX IF NOT EXISTS idx_enterprise_records_org_status
  ON public.enterprise_records (organization_id, analysis_status);