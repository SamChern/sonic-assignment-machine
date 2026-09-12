-- Admin: list predicted segments (sonic cohorts) with size and match strength.
CREATE OR REPLACE FUNCTION public.admin_cohort_list(_limit integer DEFAULT 50)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_limit integer := LEAST(GREATEST(COALESCE(_limit, 50), 1), 200);
  v_rows jsonb := '[]'::jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'admin only';
  END IF;
  PERFORM set_config('statement_timeout', '20000', true);

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', t.id,
           'name', t.name,
           'slug', t.slug,
           'organization_id', t.organization_id,
           'description', t.description,
           'export_eligible', t.export_eligible,
           'created_at', t.created_at,
           'members', t.members,
           'holdout', t.holdout,
           'avg_similarity', t.avg_similarity
         ) ORDER BY t.created_at DESC), '[]'::jsonb)
    INTO v_rows
    FROM (
      SELECT c.id, c.name, c.slug, c.organization_id, c.description,
             c.export_eligible, c.created_at,
             count(m.subject_key)::int AS members,
             count(m.subject_key) FILTER (WHERE m.holdout)::int AS holdout,
             round(avg(m.similarity)::numeric, 4) AS avg_similarity
        FROM public.sonic_cohorts c
        LEFT JOIN public.sonic_cohort_members m ON m.cohort_id = c.id
       GROUP BY c.id
       ORDER BY c.created_at DESC
       LIMIT v_limit
    ) t;

  RETURN jsonb_build_object('cohorts', v_rows, 'computed_at', now());
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_cohort_list(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_cohort_list(integer) TO authenticated, service_role;

-- Admin: drill into one predicted segment — devices, scores, tag impact.
CREATE OR REPLACE FUNCTION public.admin_cohort_explorer(
  _cohort_id uuid,
  _limit integer DEFAULT 25,
  _offset integer DEFAULT 0,
  _sample integer DEFAULT 2000,
  _window_days integer DEFAULT 90
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_limit integer := LEAST(GREATEST(COALESCE(_limit, 25), 1), 100);
  v_offset integer := GREATEST(COALESCE(_offset, 0), 0);
  v_sample integer := LEAST(GREATEST(COALESCE(_sample, 2000), 100), 20000);
  v_days integer := LEAST(GREATEST(COALESCE(_window_days, 90), 1), 365);
  v_cohort jsonb;
  v_members integer := 0;
  v_holdout integer := 0;
  v_avg_sim numeric;
  v_devices jsonb := '[]'::jsonb;
  v_scores jsonb := '{}'::jsonb;
  v_scored integer := 0;
  v_grounded integer := 0;
  v_tags jsonb := '[]'::jsonb;
  v_tag_devices integer := 0;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'admin only';
  END IF;
  PERFORM set_config('statement_timeout', '25000', true);

  SELECT jsonb_build_object(
           'id', c.id, 'name', c.name, 'slug', c.slug,
           'organization_id', c.organization_id, 'description', c.description,
           'narrative', c.narrative, 'export_eligible', c.export_eligible,
           'member_count', c.member_count, 'created_at', c.created_at)
    INTO v_cohort
    FROM public.sonic_cohorts c
   WHERE c.id = _cohort_id;

  IF v_cohort IS NULL THEN
    RAISE EXCEPTION 'segment not found';
  END IF;

  SELECT count(*)::int,
         count(*) FILTER (WHERE holdout)::int,
         round(avg(similarity)::numeric, 4)
    INTO v_members, v_holdout, v_avg_sim
    FROM public.sonic_cohort_members
   WHERE cohort_id = _cohort_id;

  -- Bounded sample of members, strongest match first, resolved to scores.
  CREATE TEMP TABLE _cx ON COMMIT DROP AS
  WITH mem AS (
    SELECT m.subject_key, m.similarity, m.holdout, m.added_at
      FROM public.sonic_cohort_members m
     WHERE m.cohort_id = _cohort_id
     ORDER BY m.similarity DESC NULLS LAST
     LIMIT v_sample
  ), q AS (
    SELECT DISTINCT ON (identifier)
           identifier, report_type, status, confidence, tags, activation_id, updated_at
      FROM public.intuizi_score_queue
     WHERE identifier IN (SELECT subject_key FROM mem)
     ORDER BY identifier, updated_at DESC
  )
  SELECT mem.subject_key,
         mem.similarity,
         mem.holdout,
         mem.added_at,
         q.report_type,
         q.status,
         q.activation_id,
         COALESCE(q.confidence, tc.confidence, lp.confidence) AS confidence,
         CASE WHEN lp.audio_source_id IS NOT NULL THEN 'audio-grounded'
              WHEN tc.scores IS NOT NULL THEN 'text-only'
              ELSE 'unscored' END AS grounding_level,
         CASE
           WHEN lp.audio_source_id IS NOT NULL THEN jsonb_build_object(
             'emotional', lp.emotional, 'cognitive', lp.cognitive, 'social', lp.social,
             'communication', lp.communication, 'contextual', lp.contextual,
             'artistic', lp.artistic)
           ELSE tc.scores END AS scores
    FROM mem
    LEFT JOIN q ON q.identifier = mem.subject_key
    LEFT JOIN public.intuizi_identifiers i ON i.primary_identifier = mem.subject_key
    LEFT JOIN public.listener_profiles lp ON lp.audio_source_id = i.audio_source_id
    LEFT JOIN public.intuizi_tag_score_cache tc
      ON tc.tag_signature = public.intuizi_tag_signature(q.report_type, q.tags)
     AND tc.report_type = q.report_type;

  SELECT count(*) FILTER (WHERE scores IS NOT NULL)::int,
         count(*) FILTER (WHERE grounding_level = 'audio-grounded')::int
    INTO v_scored, v_grounded
    FROM _cx;

  -- Average of the six axes across the members that carry scores.
  SELECT COALESCE(jsonb_object_agg(k, v), '{}'::jsonb)
    INTO v_scores
    FROM (
      SELECT k, round(avg((val)::numeric), 1) AS v
        FROM _cx, jsonb_each_text(_cx.scores) AS s(k, val)
       WHERE _cx.scores IS NOT NULL
         AND k IN ('emotional','cognitive','social','communication','contextual','artistic')
         AND val ~ '^-?[0-9]+(\.[0-9]+)?$'
       GROUP BY k
    ) a;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'subject_key', d.subject_key,
           'similarity', d.similarity,
           'holdout', d.holdout,
           'added_at', d.added_at,
           'report_type', d.report_type,
           'status', d.status,
           'activation_id', d.activation_id,
           'confidence', d.confidence,
           'grounding_level', d.grounding_level,
           'scores', d.scores
         ) ORDER BY d.similarity DESC NULLS LAST), '[]'::jsonb)
    INTO v_devices
    FROM (
      SELECT * FROM _cx
       ORDER BY similarity DESC NULLS LAST
       LIMIT v_limit OFFSET v_offset
    ) d;

  -- Measured site tag values for these devices vs. everyone else.
  WITH ev AS (
    SELECT e.kpi_metric, e.kpi_value, e.external_user_id,
           (e.external_user_id IN (SELECT subject_key FROM _cx)) AS in_segment
      FROM public.pixel_events e
     WHERE e.kpi_metric IS NOT NULL
       AND e.kpi_value IS NOT NULL
       AND e.occurred_at >= now() - make_interval(days => v_days)
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'kpi_metric', t.kpi_metric,
           'segment_events', t.seg_events,
           'segment_devices', t.seg_devices,
           'segment_avg', t.seg_avg,
           'other_events', t.oth_events,
           'other_devices', t.oth_devices,
           'other_avg', t.oth_avg,
           'lift_pct', CASE WHEN t.oth_avg IS NOT NULL AND t.oth_avg <> 0 AND t.seg_avg IS NOT NULL
                            THEN round(((t.seg_avg - t.oth_avg) / abs(t.oth_avg)) * 100, 1)
                            ELSE NULL END
         ) ORDER BY t.seg_devices DESC NULLS LAST, t.seg_events DESC), '[]'::jsonb)
    INTO v_tags
    FROM (
      SELECT kpi_metric,
             count(*) FILTER (WHERE in_segment)::int AS seg_events,
             count(DISTINCT external_user_id) FILTER (WHERE in_segment)::int AS seg_devices,
             round(avg(kpi_value) FILTER (WHERE in_segment)::numeric, 3) AS seg_avg,
             count(*) FILTER (WHERE NOT in_segment)::int AS oth_events,
             count(DISTINCT external_user_id) FILTER (WHERE NOT in_segment)::int AS oth_devices,
             round(avg(kpi_value) FILTER (WHERE NOT in_segment)::numeric, 3) AS oth_avg
        FROM ev
       GROUP BY kpi_metric
       ORDER BY 3 DESC
       LIMIT 25
    ) t;

  SELECT count(DISTINCT e.external_user_id)::int
    INTO v_tag_devices
    FROM public.pixel_events e
   WHERE e.occurred_at >= now() - make_interval(days => v_days)
     AND e.external_user_id IN (SELECT subject_key FROM _cx);

  RETURN jsonb_build_object(
    'cohort', v_cohort,
    'members', v_members,
    'holdout', v_holdout,
    'avg_similarity', v_avg_sim,
    'sampled', (SELECT count(*)::int FROM _cx),
    'sample_size', v_sample,
    'scored', v_scored,
    'audio_grounded', v_grounded,
    'avg_scores', v_scores,
    'devices', v_devices,
    'tag_impact', v_tags,
    'tag_devices', v_tag_devices,
    'window_days', v_days,
    'computed_at', now()
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_cohort_explorer(uuid, integer, integer, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_cohort_explorer(uuid, integer, integer, integer, integer) TO authenticated, service_role;