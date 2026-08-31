CREATE TABLE public.resolver_steps (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  run_id uuid NOT NULL,
  queue_id uuid REFERENCES public.resolution_queue(id) ON DELETE SET NULL,
  symbol text NOT NULL,
  step text NOT NULL,
  status text NOT NULL DEFAULT 'ok',
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  duration_ms integer,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.resolver_steps TO authenticated;
GRANT ALL ON public.resolver_steps TO service_role;
ALTER TABLE public.resolver_steps ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can read resolver steps"
  ON public.resolver_steps FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE INDEX resolver_steps_symbol_idx ON public.resolver_steps (symbol, created_at DESC);
CREATE INDEX resolver_steps_run_idx ON public.resolver_steps (run_id, created_at);

CREATE TABLE public.symbol_score_flags (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  symbol text NOT NULL,
  queue_id uuid REFERENCES public.resolution_queue(id) ON DELETE SET NULL,
  node_id uuid REFERENCES public.taxonomy_nodes(id) ON DELETE SET NULL,
  reason text NOT NULL,
  note text,
  observed_confidence numeric,
  status text NOT NULL DEFAULT 'open',
  flagged_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.symbol_score_flags TO authenticated;
GRANT ALL ON public.symbol_score_flags TO service_role;
ALTER TABLE public.symbol_score_flags ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage symbol score flags"
  ON public.symbol_score_flags FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE INDEX symbol_score_flags_symbol_idx ON public.symbol_score_flags (symbol);
CREATE INDEX symbol_score_flags_status_idx ON public.symbol_score_flags (status, created_at DESC);

CREATE TRIGGER update_symbol_score_flags_updated_at
  BEFORE UPDATE ON public.symbol_score_flags
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();