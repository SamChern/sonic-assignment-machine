ALTER TABLE public.source_analyses
  ADD COLUMN IF NOT EXISTS originality_score numeric,
  ADD COLUMN IF NOT EXISTS originality_detail jsonb;

CREATE TABLE IF NOT EXISTS public.catalog_items (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('label','album','track')),
  title text NOT NULL,
  artist text,
  label_name text,
  release_year integer,
  parent_id uuid REFERENCES public.catalog_items(id) ON DELETE SET NULL,
  audio_source_id uuid REFERENCES public.audio_sources(id) ON DELETE SET NULL,
  symbols text[] NOT NULL DEFAULT '{}',
  notes text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.catalog_items TO authenticated;
GRANT ALL ON public.catalog_items TO service_role;

ALTER TABLE public.catalog_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage their own catalog items"
ON public.catalog_items FOR ALL TO authenticated
USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS catalog_items_user_kind_idx ON public.catalog_items (user_id, kind, created_at DESC);
CREATE INDEX IF NOT EXISTS catalog_items_parent_idx ON public.catalog_items (parent_id);

CREATE TRIGGER catalog_items_set_updated_at
BEFORE UPDATE ON public.catalog_items
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();