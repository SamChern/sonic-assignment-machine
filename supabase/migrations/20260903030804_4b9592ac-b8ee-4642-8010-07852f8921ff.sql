CREATE OR REPLACE FUNCTION public.refresh_intuizi_activation_dataset(p_activation_id text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org uuid;
  v_owner uuid;
  v_name text := 'Intuizi activation ' || p_activation_id;
  v_id uuid;
  v_total integer;
  v_scored integer;
  v_avg record;
BEGIN
  SELECT organization_id, created_by INTO v_org, v_owner
    FROM public.enterprise_datasets
   WHERE source_kind = 'intuizi'
   ORDER BY created_at ASC LIMIT 1;
  IF v_org IS NULL THEN
    SELECT id INTO v_org FROM public.organizations ORDER BY created_at ASC LIMIT 1;
  END IF;
  IF v_org IS NULL THEN RETURN NULL; END IF;

  SELECT count(*)::integer INTO v_total
    FROM public.intuizi_score_queue WHERE activation_id = p_activation_id;
  SELECT count(*)::integer INTO v_scored
    FROM public.intuizi_score_queue WHERE activation_id = p_activation_id AND status = 'done';

  SELECT avg(a.emotional_score) e, avg(a.cognitive_score) c, avg(a.social_score) s,
         avg(a.communication_score) m, avg(a.contextual_score) x, avg(a.artistic_score) r
    INTO v_avg
    FROM public.source_analyses a
    JOIN public.audio_sources src ON src.id = a.audio_source_id
   WHERE src.ctv_metadata->>'activation_id' = p_activation_id;

  SELECT id INTO v_id FROM public.enterprise_datasets
   WHERE organization_id = v_org AND name = v_name LIMIT 1;

  IF v_id IS NULL THEN
    INSERT INTO public.enterprise_datasets (
      organization_id, name, description, source_kind, row_count, scored_count, status,
      emotional_avg, cognitive_avg, social_avg, communication_avg, contextual_avg, artistic_avg,
      created_by
    ) VALUES (
      v_org, v_name, 'CTV identifiers mapped to the six-category semantic layer',
      'intuizi', v_total, v_scored,
      CASE WHEN v_scored >= v_total AND v_total > 0 THEN 'ready' ELSE 'scoring' END,
      v_avg.e, v_avg.c, v_avg.s, v_avg.m, v_avg.x, v_avg.r, v_owner
    ) RETURNING id INTO v_id;
  ELSE
    UPDATE public.enterprise_datasets
       SET row_count = v_total,
           scored_count = v_scored,
           status = CASE WHEN v_scored >= v_total AND v_total > 0 THEN 'ready' ELSE 'scoring' END,
           emotional_avg = v_avg.e, cognitive_avg = v_avg.c, social_avg = v_avg.s,
           communication_avg = v_avg.m, contextual_avg = v_avg.x, artistic_avg = v_avg.r,
           updated_at = now()
     WHERE id = v_id;
  END IF;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.refresh_intuizi_activation_dataset(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_intuizi_activation_dataset(text) TO service_role;