-- sound-grounded second embedding + crosswalk on the existing spine
ALTER TABLE public.taxonomy_nodes
  ADD COLUMN IF NOT EXISTS audio_embedding vector(512),
  ADD COLUMN IF NOT EXISTS grounding_count int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS crosswalk jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS taxonomy_nodes_audio_embedding_idx
  ON public.taxonomy_nodes USING hnsw (audio_embedding vector_cosine_ops);

-- versioned text<->audio projection bridges
CREATE TABLE IF NOT EXISTS public.embedding_bridges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  from_dim int NOT NULL,
  to_dim int NOT NULL,
  weights_url text,
  eval_agreement numeric,
  is_active boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.embedding_bridges TO authenticated;
GRANT ALL ON public.embedding_bridges TO service_role;
ALTER TABLE public.embedding_bridges ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can view embedding bridges"
  ON public.embedding_bridges FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- sonic cohorts (aggregate-safe) + members (subject keys, service-role only)
CREATE TABLE IF NOT EXISTS public.sonic_cohorts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text UNIQUE NOT NULL,
  name text NOT NULL,
  description text,
  centroid vector(1536),
  member_count int NOT NULL DEFAULT 0,
  narrative text,
  export_eligible boolean GENERATED ALWAYS AS (member_count >= 1000) STORED,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.sonic_cohorts TO authenticated;
GRANT ALL ON public.sonic_cohorts TO service_role;
ALTER TABLE public.sonic_cohorts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can view sonic cohorts"
  ON public.sonic_cohorts FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE TABLE IF NOT EXISTS public.sonic_cohort_members (
  cohort_id uuid NOT NULL REFERENCES public.sonic_cohorts(id) ON DELETE CASCADE,
  subject_key text NOT NULL,
  similarity numeric,
  added_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (cohort_id, subject_key)
);

GRANT ALL ON public.sonic_cohort_members TO service_role;
ALTER TABLE public.sonic_cohort_members ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS sonic_cohort_members_subject_idx
  ON public.sonic_cohort_members (subject_key);

CREATE TRIGGER update_sonic_cohorts_updated_at
  BEFORE UPDATE ON public.sonic_cohorts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();