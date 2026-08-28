CREATE TABLE IF NOT EXISTS public.semantic_call_log (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  service text NOT NULL DEFAULT 'semantic_svc',
  action text NOT NULL,
  outcome text NOT NULL,
  cache_hit boolean NOT NULL DEFAULT false,
  duration_ms integer,
  http_status integer,
  dims integer,
  subject_ref text,
  error_message text,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

GRANT SELECT ON public.semantic_call_log TO authenticated;
GRANT ALL ON public.semantic_call_log TO service_role;

ALTER TABLE public.semantic_call_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can read semantic call log"
ON public.semantic_call_log
FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

CREATE INDEX IF NOT EXISTS semantic_call_log_created_idx
ON public.semantic_call_log (created_at DESC);