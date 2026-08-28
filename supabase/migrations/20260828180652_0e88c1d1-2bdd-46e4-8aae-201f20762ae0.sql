CREATE INDEX IF NOT EXISTS taxonomy_nodes_code_prefix_idx
  ON public.taxonomy_nodes (code text_pattern_ops);

CREATE OR REPLACE FUNCTION public.match_audioset_nodes(
  query_embedding vector(512),
  match_count integer DEFAULT 3
)
RETURNS TABLE(id uuid, code text, label text, similarity double precision)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT n.id,
         n.code,
         n.label,
         1 - (n.audio_embedding <=> query_embedding) AS similarity
  FROM public.taxonomy_nodes n
  WHERE n.audio_embedding IS NOT NULL
    AND n.code LIKE 'aset.%'
  ORDER BY n.audio_embedding <=> query_embedding
  LIMIT GREATEST(1, LEAST(20, match_count));
$$;

REVOKE ALL ON FUNCTION public.match_audioset_nodes(vector, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.match_audioset_nodes(vector, integer) TO service_role;