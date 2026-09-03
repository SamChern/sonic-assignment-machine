REVOKE ALL ON FUNCTION public.claim_intuizi_score_jobs(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_intuizi_score_jobs(integer) FROM anon;
REVOKE ALL ON FUNCTION public.claim_intuizi_score_jobs(integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.claim_intuizi_score_jobs(integer) TO service_role;