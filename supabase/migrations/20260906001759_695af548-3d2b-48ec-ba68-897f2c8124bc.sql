CREATE TABLE public.resonance_runs (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  label text,
  engine text NOT NULL DEFAULT 'on-device-audio',
  features jsonb NOT NULL DEFAULT '{}'::jsonb,
  scores jsonb NOT NULL DEFAULT '{}'::jsonb,
  audience jsonb NOT NULL DEFAULT '{}'::jsonb,
  resonance_score numeric,
  weakest_axis text,
  confidence numeric,
  definition_version text,
  is_public_example boolean NOT NULL DEFAULT false,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

GRANT SELECT ON public.resonance_runs TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.resonance_runs TO authenticated;
GRANT ALL ON public.resonance_runs TO service_role;

ALTER TABLE public.resonance_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage resonance runs"
ON public.resonance_runs FOR ALL TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Users read their own resonance runs"
ON public.resonance_runs FOR SELECT TO authenticated
USING (created_by = auth.uid());

CREATE POLICY "Anyone reads public worked examples"
ON public.resonance_runs FOR SELECT TO anon, authenticated
USING (is_public_example = true);

CREATE INDEX idx_resonance_runs_created_at ON public.resonance_runs (created_at DESC);
CREATE INDEX idx_resonance_runs_public ON public.resonance_runs (is_public_example, created_at DESC);

CREATE TRIGGER update_resonance_runs_updated_at
BEFORE UPDATE ON public.resonance_runs
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();