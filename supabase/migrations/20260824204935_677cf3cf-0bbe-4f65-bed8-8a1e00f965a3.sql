CREATE TABLE public.intuizi_mcp_runs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tool_name TEXT NOT NULL,
  arguments JSONB NOT NULL DEFAULT '{}'::jsonb,
  idempotency_key TEXT,
  resource_type TEXT,
  resource_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  error TEXT,
  delivered_keys JSONB NOT NULL DEFAULT '[]'::jsonb,
  run_by UUID REFERENCES auth.users,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.intuizi_mcp_runs TO authenticated;
GRANT ALL ON public.intuizi_mcp_runs TO service_role;

ALTER TABLE public.intuizi_mcp_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view intuizi mcp runs"
  ON public.intuizi_mcp_runs FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can insert intuizi mcp runs"
  ON public.intuizi_mcp_runs FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin') AND run_by = auth.uid());

CREATE INDEX idx_intuizi_mcp_runs_created_at ON public.intuizi_mcp_runs (created_at DESC);
CREATE INDEX idx_intuizi_mcp_runs_resource ON public.intuizi_mcp_runs (resource_type, resource_id);

CREATE TRIGGER update_intuizi_mcp_runs_updated_at
  BEFORE UPDATE ON public.intuizi_mcp_runs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();