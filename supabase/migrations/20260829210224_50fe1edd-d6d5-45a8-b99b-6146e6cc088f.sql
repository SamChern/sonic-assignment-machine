CREATE OR REPLACE FUNCTION public.intuizi_score_queue_depth(p_cap integer DEFAULT 5000)
RETURNS TABLE(pending_capped integer, dead_letter_capped integer, capped_at integer)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT
    (SELECT count(*)::int FROM (
       SELECT 1 FROM public.intuizi_score_queue
       WHERE status IN ('pending','processing') LIMIT p_cap) s),
    (SELECT count(*)::int FROM (
       SELECT 1 FROM public.intuizi_score_queue
       WHERE status = 'dead_letter' LIMIT p_cap) d),
    p_cap;
$$;

REVOKE EXECUTE ON FUNCTION public.intuizi_score_queue_depth(integer) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.intuizi_score_queue_depth(integer) TO service_role;