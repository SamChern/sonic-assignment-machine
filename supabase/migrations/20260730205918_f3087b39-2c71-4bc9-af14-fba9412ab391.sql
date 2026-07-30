-- 1.1 content-addressed cache + 1.2 single-flight
CREATE TABLE public.librosa_cache (
  cache_key text PRIMARY KEY,
  params jsonb NOT NULL DEFAULT '{}'::jsonb,
  features jsonb,
  status text NOT NULL DEFAULT 'pending',
  hit_count integer NOT NULL DEFAULT 0,
  error_message text,
  started_at timestamptz NOT NULL DEFAULT now(),
  ready_at timestamptz,
  last_hit_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.librosa_cache TO authenticated;
GRANT ALL ON public.librosa_cache TO service_role;
ALTER TABLE public.librosa_cache ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Signed in users can read librosa cache"
  ON public.librosa_cache FOR SELECT TO authenticated USING (true);

CREATE INDEX idx_librosa_cache_status ON public.librosa_cache (status, started_at);

-- 1.4 database-backed job queue
CREATE TABLE public.analysis_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  audio_source_id uuid,
  user_id uuid,
  cache_key text NOT NULL,
  kind text NOT NULL DEFAULT 'librosa_full',
  params jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pending',
  priority integer NOT NULL DEFAULT 100,
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  finished_at timestamptz
);
GRANT SELECT ON public.analysis_jobs TO authenticated;
GRANT ALL ON public.analysis_jobs TO service_role;
ALTER TABLE public.analysis_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users read their own analysis jobs"
  ON public.analysis_jobs FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'::app_role));

CREATE INDEX idx_analysis_jobs_claim ON public.analysis_jobs (status, priority, created_at);
CREATE INDEX idx_analysis_jobs_source ON public.analysis_jobs (audio_source_id);

-- 1.8 observability
CREATE TABLE public.librosa_call_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cache_key text,
  audio_source_id uuid,
  outcome text NOT NULL,
  cache_hit boolean NOT NULL DEFAULT false,
  duration_ms integer,
  http_status integer,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.librosa_call_log TO authenticated;
GRANT ALL ON public.librosa_call_log TO service_role;
ALTER TABLE public.librosa_call_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Signed in users can read call log"
  ON public.librosa_call_log FOR SELECT TO authenticated USING (true);

CREATE INDEX idx_librosa_call_log_created ON public.librosa_call_log (created_at DESC);

-- 1.5 UI progress fields
ALTER TABLE public.audio_sources
  ADD COLUMN IF NOT EXISTS analysis_status text NOT NULL DEFAULT 'idle',
  ADD COLUMN IF NOT EXISTS analysis_error text;

-- Phase 3 hot-path indexes
CREATE INDEX IF NOT EXISTS idx_source_analyses_user_created
  ON public.source_analyses (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audio_sources_user_type
  ON public.audio_sources (user_id, source_type);