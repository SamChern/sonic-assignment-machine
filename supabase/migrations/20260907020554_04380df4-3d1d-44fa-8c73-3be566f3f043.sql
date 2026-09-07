DROP VIEW IF EXISTS public.audio_sources_public;

CREATE OR REPLACE FUNCTION public.public_audio_sources(_user_ids uuid[], _limit integer DEFAULT 200)
RETURNS TABLE(
  id uuid, user_id uuid, name text, artists text[], album_name text,
  album_image text, source_type text, spotify_id text,
  analysis_status text, created_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT s.id, s.user_id, s.name, s.artists, s.album_name, s.album_image,
         s.source_type, s.spotify_id, s.analysis_status, s.created_at
  FROM public.audio_sources s
  WHERE s.user_id = ANY(_user_ids)
  ORDER BY s.created_at DESC
  LIMIT LEAST(GREATEST(COALESCE(_limit, 200), 1), 1000)
$$;

REVOKE ALL ON FUNCTION public.public_audio_sources(uuid[], integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.public_audio_sources(uuid[], integer) TO authenticated, service_role;