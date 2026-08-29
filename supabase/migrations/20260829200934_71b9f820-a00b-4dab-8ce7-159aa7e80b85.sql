-- ============================================================
-- Step 2.5-alt: ingest worker staging + claim/finish RPCs
-- ============================================================

CREATE TABLE public.ingest_rollups (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  object_key text NOT NULL,
  report_type text,
  subject_key text NOT NULL,
  taxonomy_code text NOT NULL,
  day date,
  weight numeric NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.ingest_rollups TO service_role;

ALTER TABLE public.ingest_rollups ENABLE ROW LEVEL SECURITY;

-- Service-role only (the worker writes through the edge function); admins may
-- read aggregate counts for the ledger.
CREATE POLICY "Admins can view ingest rollups"
  ON public.ingest_rollups FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE INDEX idx_ingest_rollups_object_key ON public.ingest_rollups (object_key);
CREATE INDEX idx_ingest_rollups_subject_key ON public.ingest_rollups (subject_key);

CREATE TABLE public.worker_heartbeats (
  worker_id text PRIMARY KEY,
  host text,
  last_seen timestamptz NOT NULL DEFAULT now(),
  stats jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.worker_heartbeats TO authenticated;
GRANT ALL ON public.worker_heartbeats TO service_role;

ALTER TABLE public.worker_heartbeats ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view worker heartbeats"
  ON public.worker_heartbeats FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER update_worker_heartbeats_updated_at
  BEFORE UPDATE ON public.worker_heartbeats
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ------------------------------------------------------------
-- Claim / finish routines (service-role callers only; the worker
-- reaches these through the ingest-worker-callback edge function)
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.claim_next_ingest_file(p_worker text)
RETURNS TABLE(id uuid, object_key text, report_type text, trace_id text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  SELECT f.id INTO v_id
  FROM public.intuizi_ingest_files f
  WHERE f.status = 'discovered'
  ORDER BY f.discovered_at ASC
  FOR UPDATE SKIP LOCKED
  LIMIT 1;

  IF v_id IS NULL THEN
    RETURN;
  END IF;

  UPDATE public.intuizi_ingest_files f
  SET status = 'processing',
      worker_id = p_worker,
      started_at = now(),
      heartbeat_at = now(),
      error_message = NULL,
      trace_id = COALESCE(f.trace_id, 'worker-' || replace(gen_random_uuid()::text, '-', ''))
  WHERE f.id = v_id;

  RETURN QUERY
  SELECT f.id, f.object_key, f.report_type, f.trace_id
  FROM public.intuizi_ingest_files f
  WHERE f.id = v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_ingest_file(
  p_id uuid,
  p_rows integer,
  p_status text DEFAULT 'loaded'
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.intuizi_ingest_files
  SET status = COALESCE(p_status, 'loaded'),
      processed_rows = GREATEST(COALESCE(p_rows, 0), 0),
      failed_rows = 0,
      error_message = NULL,
      heartbeat_at = now(),
      finished_at = now()
  WHERE id = p_id;
$$;

CREATE OR REPLACE FUNCTION public.fail_ingest_file(p_id uuid, p_error text)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.intuizi_ingest_files
  SET status = 'failed',
      error_message = left(COALESCE(p_error, 'worker reported a failure'), 2000),
      heartbeat_at = now(),
      finished_at = now()
  WHERE id = p_id;
$$;

CREATE OR REPLACE FUNCTION public.skip_ingest_file(p_id uuid, p_reason text)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.intuizi_ingest_files
  SET status = 'skipped',
      error_message = left(COALESCE(p_reason, 'skipped by worker'), 2000),
      heartbeat_at = now(),
      finished_at = now()
  WHERE id = p_id;
$$;

REVOKE ALL ON FUNCTION public.claim_next_ingest_file(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.complete_ingest_file(uuid, integer, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fail_ingest_file(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.skip_ingest_file(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_next_ingest_file(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_ingest_file(uuid, integer, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.fail_ingest_file(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.skip_ingest_file(uuid, text) TO service_role;

-- ------------------------------------------------------------
-- Reaper: return abandoned claims to the waiting list
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.reap_stale_ingest_claims(p_stale_minutes integer DEFAULT 30)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  WITH reaped AS (
    UPDATE public.intuizi_ingest_files
    SET status = 'discovered',
        worker_id = NULL,
        started_at = NULL,
        error_message = 'reclaimed after stale claim'
    WHERE status = 'processing'
      AND COALESCE(heartbeat_at, started_at, discovered_at)
            < now() - make_interval(mins => GREATEST(COALESCE(p_stale_minutes, 30), 5))
    RETURNING 1
  )
  SELECT count(*) INTO v_count FROM reaped;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.reap_stale_ingest_claims(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reap_stale_ingest_claims(integer) TO service_role;

SELECT cron.schedule(
  'reap-stale-ingest-claims',
  '*/10 * * * *',
  $$SELECT public.reap_stale_ingest_claims(30);$$
);