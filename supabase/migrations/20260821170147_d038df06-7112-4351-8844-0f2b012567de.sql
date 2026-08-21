CREATE TABLE IF NOT EXISTS public.semantic_normalization (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  scope text NOT NULL UNIQUE,
  enabled boolean NOT NULL DEFAULT true,
  speech_bias numeric NOT NULL DEFAULT 0.5 CHECK (speech_bias >= 0 AND speech_bias <= 1),
  redistribute boolean NOT NULL DEFAULT true,
  gains jsonb NOT NULL DEFAULT '{"emotional":1,"cognitive":1,"social":1,"communication":1,"contextual":1,"artistic":1}'::jsonb,
  notes text,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.semantic_normalization TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.semantic_normalization TO authenticated;
GRANT ALL ON public.semantic_normalization TO service_role;

ALTER TABLE public.semantic_normalization ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can view normalization settings"
  ON public.semantic_normalization FOR SELECT TO authenticated USING (true);

CREATE POLICY "Admins can insert normalization settings"
  ON public.semantic_normalization FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can update normalization settings"
  ON public.semantic_normalization FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can delete normalization settings"
  ON public.semantic_normalization FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER update_semantic_normalization_updated_at
  BEFORE UPDATE ON public.semantic_normalization
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.source_analyses
  ADD COLUMN IF NOT EXISTS raw_scores jsonb,
  ADD COLUMN IF NOT EXISTS normalization jsonb;

INSERT INTO public.semantic_normalization (scope, enabled, speech_bias, redistribute, notes)
VALUES
  ('intuizi', true, 0.5, true, 'Corrects for spoken-word/vocal skew in Intuizi CTV and audio-app feeds.'),
  ('ctv', true, 0.4, true, 'Corrects for dialogue-heavy CTV content.'),
  ('global', false, 0.0, true, 'Default: no normalization for music/file uploads.')
ON CONFLICT (scope) DO NOTHING;