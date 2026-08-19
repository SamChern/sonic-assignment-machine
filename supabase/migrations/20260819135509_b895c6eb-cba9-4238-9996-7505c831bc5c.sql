-- Ingest file ledger
CREATE TABLE public.intuizi_ingest_files (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  object_key TEXT NOT NULL UNIQUE,
  report_type TEXT NOT NULL,
  partition_date DATE,
  size_bytes BIGINT,
  etag TEXT,
  status TEXT NOT NULL DEFAULT 'discovered',
  total_rows INTEGER NOT NULL DEFAULT 0,
  processed_rows INTEGER NOT NULL DEFAULT 0,
  failed_rows INTEGER NOT NULL DEFAULT 0,
  cursor_offset INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  discovered_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  started_at TIMESTAMP WITH TIME ZONE,
  finished_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

GRANT SELECT ON public.intuizi_ingest_files TO authenticated;
GRANT ALL ON public.intuizi_ingest_files TO service_role;
ALTER TABLE public.intuizi_ingest_files ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read intuizi files" ON public.intuizi_ingest_files
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

CREATE INDEX idx_intuizi_files_status ON public.intuizi_ingest_files (status, discovered_at);
CREATE INDEX idx_intuizi_files_report ON public.intuizi_ingest_files (report_type, partition_date DESC);

CREATE TRIGGER trg_intuizi_files_updated
  BEFORE UPDATE ON public.intuizi_ingest_files
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Per-identifier signal rollup
CREATE TABLE public.intuizi_identifiers (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  primary_identifier TEXT NOT NULL UNIQUE,
  ctv_signals JSONB NOT NULL DEFAULT '{}'::jsonb,
  apps_signals JSONB NOT NULL DEFAULT '{}'::jsonb,
  visitation_signals JSONB NOT NULL DEFAULT '{}'::jsonb,
  demographics_signals JSONB NOT NULL DEFAULT '{}'::jsonb,
  origin_signals JSONB NOT NULL DEFAULT '{}'::jsonb,
  tag_codes TEXT[] NOT NULL DEFAULT '{}',
  audio_source_id UUID REFERENCES public.audio_sources(id) ON DELETE SET NULL,
  observation_count INTEGER NOT NULL DEFAULT 0,
  last_seen_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

GRANT SELECT ON public.intuizi_identifiers TO authenticated;
GRANT ALL ON public.intuizi_identifiers TO service_role;
ALTER TABLE public.intuizi_identifiers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read intuizi identifiers" ON public.intuizi_identifiers
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

CREATE INDEX idx_intuizi_identifiers_seen ON public.intuizi_identifiers (last_seen_at DESC);
CREATE INDEX idx_intuizi_identifiers_tags ON public.intuizi_identifiers USING GIN (tag_codes);

CREATE TRIGGER trg_intuizi_identifiers_updated
  BEFORE UPDATE ON public.intuizi_identifiers
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Single-row control state: lease lock + circuit breaker
CREATE TABLE public.intuizi_ingest_state (
  id TEXT NOT NULL PRIMARY KEY DEFAULT 'singleton',
  lease_until TIMESTAMP WITH TIME ZONE,
  lease_owner TEXT,
  paused BOOLEAN NOT NULL DEFAULT false,
  pause_reason TEXT,
  paused_at TIMESTAMP WITH TIME ZONE,
  parked_until TIMESTAMP WITH TIME ZONE,
  consecutive_rate_limits INTEGER NOT NULL DEFAULT 0,
  last_run_at TIMESTAMP WITH TIME ZONE,
  last_run_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_error TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  CONSTRAINT intuizi_state_singleton CHECK (id = 'singleton')
);

GRANT SELECT ON public.intuizi_ingest_state TO authenticated;
GRANT ALL ON public.intuizi_ingest_state TO service_role;
ALTER TABLE public.intuizi_ingest_state ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read intuizi state" ON public.intuizi_ingest_state
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER trg_intuizi_state_updated
  BEFORE UPDATE ON public.intuizi_ingest_state
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO public.intuizi_ingest_state (id) VALUES ('singleton');

-- Single-flight lease acquisition
CREATE OR REPLACE FUNCTION public.acquire_intuizi_lease(p_owner TEXT, p_seconds INTEGER DEFAULT 300)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ok BOOLEAN;
BEGIN
  UPDATE public.intuizi_ingest_state
  SET lease_until = now() + make_interval(secs => p_seconds),
      lease_owner = p_owner
  WHERE id = 'singleton'
    AND (lease_until IS NULL OR lease_until < now());
  GET DIAGNOSTICS v_ok = ROW_COUNT;
  RETURN v_ok;
END;
$$;

CREATE OR REPLACE FUNCTION public.release_intuizi_lease(p_owner TEXT)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.intuizi_ingest_state
  SET lease_until = NULL, lease_owner = NULL
  WHERE id = 'singleton' AND lease_owner = p_owner;
$$;