REVOKE ALL ON FUNCTION public.enqueue_score_tasks(jsonb) FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.requeue_ingest_file(uuid, text, integer) FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.block_ingest_file(uuid, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_score_tasks(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.requeue_ingest_file(uuid, text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.block_ingest_file(uuid, text) TO service_role;