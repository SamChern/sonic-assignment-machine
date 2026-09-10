CREATE OR REPLACE FUNCTION public.admin_intuizi_grounding_coverage()
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_queue jsonb;
  v_ground jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'admin only';
  END IF;
  PERFORM set_config('statement_timeout', '25000', true);

  SELECT jsonb_object_agg(status, n) INTO v_queue
  FROM (SELECT status, count(*) AS n FROM public.intuizi_score_queue GROUP BY status) q;

  SELECT jsonb_object_agg(level, jsonb_build_object(
           'profiles', profiles, 'identifiers', identifiers, 'with_audio', with_audio))
    INTO v_ground
  FROM (
    SELECT coalesce(grounding_level, 'text-only') AS level,
           count(*) AS profiles,
           coalesce(sum(identifier_count), 0) AS identifiers,
           count(*) FILTER (WHERE has_audio_embedding) AS with_audio
    FROM public.listener_profiles
    GROUP BY 1
  ) g;

  RETURN jsonb_build_object(
    'queue', coalesce(v_queue, '{}'::jsonb),
    'grounding', coalesce(v_ground, '{}'::jsonb),
    'computed_at', now()
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_intuizi_grounding_coverage() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_intuizi_grounding_coverage() TO authenticated, service_role;