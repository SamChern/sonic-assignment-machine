REVOKE ALL ON FUNCTION public.acquire_job_worker_lease(text, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.release_job_worker_lease(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.acquire_job_worker_lease(text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_job_worker_lease(text) TO service_role;