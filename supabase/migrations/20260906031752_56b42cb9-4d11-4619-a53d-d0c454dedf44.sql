CREATE OR REPLACE FUNCTION public.intuizi_score_queue_depth(p_cap integer DEFAULT 5000)
 RETURNS TABLE(pending_capped integer, dead_letter_capped integer, capped_at integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_cap integer := greatest(100, least(coalesce(p_cap, 5000), 200000));
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'admin only';
  END IF;
  RETURN QUERY
  SELECT
    (SELECT count(*)::int FROM (
       SELECT 1 FROM public.intuizi_score_queue
       WHERE status IN ('pending','processing') LIMIT v_cap) s),
    (SELECT count(*)::int FROM (
       SELECT 1 FROM public.intuizi_score_queue
       WHERE status = 'dead_letter' LIMIT v_cap) d),
    v_cap;
END;
$function$;

REVOKE ALL ON FUNCTION public.intuizi_score_queue_depth(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.intuizi_score_queue_depth(integer) TO authenticated, service_role;

GRANT SELECT ON public.intuizi_cost_estimate_cache TO authenticated;

DROP POLICY IF EXISTS "Admins read scoring cost cache" ON public.intuizi_cost_estimate_cache;
CREATE POLICY "Admins read scoring cost cache"
  ON public.intuizi_cost_estimate_cache
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));