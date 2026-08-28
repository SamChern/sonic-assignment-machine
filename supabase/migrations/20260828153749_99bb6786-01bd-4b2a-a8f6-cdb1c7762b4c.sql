ALTER TABLE public.intuizi_ingest_files
  ADD COLUMN IF NOT EXISTS enqueued_at timestamptz,
  ADD COLUMN IF NOT EXISTS queue_message_id text,
  ADD COLUMN IF NOT EXISTS trace_id text,
  ADD COLUMN IF NOT EXISTS worker_id text,
  ADD COLUMN IF NOT EXISTS heartbeat_at timestamptz,
  ADD COLUMN IF NOT EXISTS dispatch_attempts integer NOT NULL DEFAULT 0;

-- Find stalled claims: 'processing' rows whose worker stopped heartbeating.
CREATE INDEX IF NOT EXISTS intuizi_ingest_files_heartbeat_idx
  ON public.intuizi_ingest_files (status, heartbeat_at);

-- Find work awaiting dispatch / in flight.
CREATE INDEX IF NOT EXISTS intuizi_ingest_files_status_enqueued_idx
  ON public.intuizi_ingest_files (status, enqueued_at);