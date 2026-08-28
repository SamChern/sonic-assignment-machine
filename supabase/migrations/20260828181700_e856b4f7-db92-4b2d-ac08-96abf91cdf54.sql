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
  -- Ordering on the similarity expression (rather than the raw distance
  -- operator) keeps this an exact scan over the small aset.* set; the shared
  -- HNSW index is tuned for the much larger subject-vector workload and
  -- returned no candidates once the aset.* filter was applied.
  SELECT n.id,
         n.code,
         n.label,
         1 - (n.audio_embedding <=> query_embedding) AS similarity
  FROM public.taxonomy_nodes n
  WHERE n.audio_embedding IS NOT NULL
    AND n.code LIKE 'aset.%'
  ORDER BY 1 - (n.audio_embedding <=> query_embedding) DESC
  LIMIT GREATEST(1, LEAST(20, match_count));
$$;

REVOKE ALL ON FUNCTION public.match_audioset_nodes(vector, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.match_audioset_nodes(vector, integer) TO service_role;