CREATE TABLE public.resolution_queue (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  symbol text NOT NULL,
  symbol_type text NOT NULL DEFAULT 'other',
  context jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pending',
  attempts integer NOT NULL DEFAULT 0,
  sightings integer NOT NULL DEFAULT 1,
  last_error text,
  resolved_node_id uuid REFERENCES public.taxonomy_nodes(id) ON DELETE SET NULL,
  first_seen_at timestamp with time zone NOT NULL DEFAULT now(),
  last_seen_at timestamp with time zone NOT NULL DEFAULT now(),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

GRANT SELECT ON public.resolution_queue TO authenticated;
GRANT ALL ON public.resolution_queue TO service_role;

ALTER TABLE public.resolution_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can read the resolution queue"
  ON public.resolution_queue FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE UNIQUE INDEX resolution_queue_symbol_key
  ON public.resolution_queue (symbol_type, lower(symbol));
CREATE INDEX resolution_queue_status_idx
  ON public.resolution_queue (status, first_seen_at);

CREATE TRIGGER update_resolution_queue_updated_at
  BEFORE UPDATE ON public.resolution_queue
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.taxonomy_nodes
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'catalog',
  ADD COLUMN IF NOT EXISTS reviewed boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS proposal jsonb;

UPDATE public.taxonomy_nodes SET source = 'catalog', reviewed = true
  WHERE source IS NULL OR source = '';

CREATE INDEX IF NOT EXISTS taxonomy_nodes_agent_unreviewed_idx
  ON public.taxonomy_nodes (source, reviewed);

INSERT INTO public.control_registry (key, value, value_type, bounds, description, category)
VALUES
  ('resolver.enabled', 'true'::jsonb, 'boolean', NULL,
   'Master switch for the nightly Resolver agent run.', 'resolver'),
  ('resolver.model', '"openai/gpt-5.6-sol"'::jsonb, 'json', NULL,
   'Lovable AI Gateway model that drives the Resolver agent.', 'resolver'),
  ('resolver.escalate_model', '"openai/gpt-5.6-sol"'::jsonb, 'json', NULL,
   'Model used for one escalation retry on low-confidence resolutions.', 'resolver'),
  ('resolver.daily_budget', '2.5'::jsonb, 'number', '{"min":0,"max":100}'::jsonb,
   'Estimated USD spend ceiling per Resolver day; the run halts when reached.', 'resolver'),
  ('resolver.batch_max', '40'::jsonb, 'number', '{"min":1,"max":500}'::jsonb,
   'Maximum queue rows drained in one nightly Resolver run.', 'resolver'),
  ('resolver.min_confidence', '0.45'::jsonb, 'number', '{"min":0,"max":1}'::jsonb,
   'Below this confidence a resolution is escalated once, then parked as failed.', 'resolver')
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.job_worker_state (id, paused)
VALUES ('signal-resolver', false)
ON CONFLICT (id) DO NOTHING;