-- Hot read paths
CREATE INDEX IF NOT EXISTS idx_source_analyses_source_created
  ON public.source_analyses (audio_source_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_source_analyses_category
  ON public.source_analyses (category);

CREATE INDEX IF NOT EXISTS idx_audio_sources_pending
  ON public.audio_sources (analysis_status)
  WHERE analysis_status IN ('pending','processing','failed');

CREATE INDEX IF NOT EXISTS idx_audio_sources_spotify_id
  ON public.audio_sources (spotify_id)
  WHERE spotify_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_audio_sources_missing_features
  ON public.audio_sources (created_at DESC)
  WHERE librosa_features IS NULL;

CREATE INDEX IF NOT EXISTS idx_taxonomy_nodes_code
  ON public.taxonomy_nodes (code);

CREATE INDEX IF NOT EXISTS idx_librosa_cache_last_hit
  ON public.librosa_cache (last_hit_at DESC NULLS LAST);

-- Partial vector index matching the actual query predicate
DROP INDEX IF EXISTS public.idx_audio_sources_profile_embedding;
CREATE INDEX idx_audio_sources_profile_embedding
  ON public.audio_sources USING hnsw (profile_embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 96)
  WHERE profile_embedding IS NOT NULL;

-- Retention / maintenance
CREATE OR REPLACE FUNCTION public.prune_analysis_telemetry(
  p_log_days integer DEFAULT 30,
  p_job_days integer DEFAULT 7,
  p_cache_idle_days integer DEFAULT 180
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_logs integer;
  v_jobs integer;
  v_cache integer;
BEGIN
  DELETE FROM public.librosa_call_log
  WHERE created_at < now() - make_interval(days => p_log_days);
  GET DIAGNOSTICS v_logs = ROW_COUNT;

  DELETE FROM public.analysis_jobs
  WHERE status IN ('done','failed')
    AND finished_at IS NOT NULL
    AND finished_at < now() - make_interval(days => p_job_days);
  GET DIAGNOSTICS v_jobs = ROW_COUNT;

  DELETE FROM public.librosa_cache
  WHERE status = 'failed'
    AND created_at < now() - make_interval(days => p_job_days);
  GET DIAGNOSTICS v_cache = ROW_COUNT;

  RETURN jsonb_build_object(
    'logs_deleted', v_logs,
    'jobs_deleted', v_jobs,
    'cache_rows_deleted', v_cache
  );
END;
$$;

REVOKE ALL ON FUNCTION public.prune_analysis_telemetry(integer, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prune_analysis_telemetry(integer, integer, integer) TO service_role;

ANALYZE public.audio_sources;
ANALYZE public.source_analyses;