CREATE TABLE public.intuizi_score_queue (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  object_key text NOT NULL,
  report_type text NOT NULL,
  identifier text NOT NULL,
  activation_id text,
  owner_id uuid,
  label text,
  tags jsonb NOT NULL DEFAULT '[]'::jsonb,
  signals jsonb NOT NULL DEFAULT '[]'::jsonb,
  confidence numeric NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending',
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT intuizi_score_queue_unique_item UNIQUE (object_key, identifier)
);

CREATE INDEX idx_intuizi_score_queue_pending ON public.intuizi_score_queue (status, created_at);
CREATE INDEX idx_intuizi_score_queue_activation ON public.intuizi_score_queue (activation_id);

GRANT ALL ON public.intuizi_score_queue TO service_role;
GRANT SELECT ON public.intuizi_score_queue TO authenticated;

ALTER TABLE public.intuizi_score_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view the intuizi score queue"
ON public.intuizi_score_queue FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER update_intuizi_score_queue_updated_at
BEFORE UPDATE ON public.intuizi_score_queue
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE FUNCTION public.claim_intuizi_score_jobs(p_limit integer DEFAULT 3)
RETURNS SETOF public.intuizi_score_queue
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  UPDATE public.intuizi_score_queue q
  SET status = 'processing',
      started_at = now(),
      attempts = q.attempts + 1
  WHERE q.id IN (
    SELECT c.id
    FROM public.intuizi_score_queue c
    WHERE (c.status = 'pending' AND c.attempts < 5)
       OR (c.status = 'processing' AND c.started_at < now() - interval '5 minutes' AND c.attempts < 5)
    ORDER BY c.created_at ASC
    FOR UPDATE SKIP LOCKED
    LIMIT p_limit
  )
  RETURNING q.*;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_intuizi_score_jobs(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_intuizi_score_jobs(integer) TO service_role;