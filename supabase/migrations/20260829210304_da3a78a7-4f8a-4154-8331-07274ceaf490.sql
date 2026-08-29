REVOKE EXECUTE ON FUNCTION public.intuizi_score_queue_depth(integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.claim_intuizi_score_jobs(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.intuizi_score_queue_depth(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_intuizi_score_jobs(integer) TO service_role;