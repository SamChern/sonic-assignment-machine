-- Storage policies for the private user-audio bucket: each user owns a folder
-- named after their auth uid.
CREATE POLICY "Users can upload their own audio"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'user-audio' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "Users can read their own audio"
ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'user-audio' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "Users can update their own audio"
ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id = 'user-audio' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "Users can delete their own audio"
ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'user-audio' AND (storage.foldername(name))[1] = auth.uid()::text);

-- Background worker coordination state (single row).
CREATE TABLE public.job_worker_state (
  id text PRIMARY KEY DEFAULT 'singleton',
  lease_until timestamptz,
  lease_owner text,
  paused boolean NOT NULL DEFAULT false,
  pause_reason text,
  paused_at timestamptz,
  last_kick_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.job_worker_state TO authenticated;
GRANT ALL ON public.job_worker_state TO service_role;

ALTER TABLE public.job_worker_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Signed-in users can read worker state"
ON public.job_worker_state FOR SELECT TO authenticated
USING (true);

CREATE TRIGGER trg_job_worker_state_updated
BEFORE UPDATE ON public.job_worker_state
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO public.job_worker_state (id) VALUES ('singleton')
ON CONFLICT (id) DO NOTHING;

-- Single-flight lease: only one background drain may run at a time.
CREATE OR REPLACE FUNCTION public.acquire_job_worker_lease(p_owner text, p_seconds integer DEFAULT 20)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_ok boolean;
BEGIN
  UPDATE public.job_worker_state
  SET lease_until = now() + make_interval(secs => p_seconds),
      lease_owner = p_owner,
      last_kick_at = now()
  WHERE id = 'singleton'
    AND paused = false
    AND (lease_until IS NULL OR lease_until < now());
  GET DIAGNOSTICS v_ok = ROW_COUNT;
  RETURN v_ok;
END;
$$;

CREATE OR REPLACE FUNCTION public.release_job_worker_lease(p_owner text)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  UPDATE public.job_worker_state
  SET lease_until = NULL, lease_owner = NULL
  WHERE id = 'singleton' AND lease_owner = p_owner;
$$;

-- Keep per-user job status lookups fast as the queue grows.
CREATE INDEX IF NOT EXISTS analysis_jobs_user_status_idx
ON public.analysis_jobs (user_id, status, created_at DESC);