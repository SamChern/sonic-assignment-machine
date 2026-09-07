-- 1. sonic_signatures: admin-only direct reads
DROP POLICY IF EXISTS "Signatures are readable by signed-in users" ON public.sonic_signatures;
CREATE POLICY "Admins can read signatures" ON public.sonic_signatures
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- 2. signatures storage bucket: admin-only reads (app uses service-role signed URLs)
DROP POLICY IF EXISTS "Signed-in users can read signature audio" ON storage.objects;
CREATE POLICY "Admins can read signature audio" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'signatures' AND public.has_role(auth.uid(), 'admin'));

-- 3. librosa_cache: admin-only direct reads + exact-key helper
DROP POLICY IF EXISTS "Signed in users can read librosa cache" ON public.librosa_cache;
CREATE POLICY "Admins can read librosa cache" ON public.librosa_cache
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE OR REPLACE FUNCTION public.get_librosa_features(_cache_key text)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT c.features
  FROM public.librosa_cache c
  WHERE c.cache_key = _cache_key
    AND c.status = 'ready'
    AND auth.uid() IS NOT NULL
  LIMIT 1
$$;
REVOKE ALL ON FUNCTION public.get_librosa_features(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_librosa_features(text) TO authenticated, service_role;

-- 4. profiles: owner + admin only, with a limited public listing helper
DROP POLICY IF EXISTS "Signed-in users can view profiles" ON public.profiles;
CREATE POLICY "Users can view their own profile" ON public.profiles
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);
CREATE POLICY "Admins can view all profiles" ON public.profiles
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE OR REPLACE FUNCTION public.public_profiles(_user_ids uuid[] DEFAULT NULL, _search text DEFAULT NULL, _limit integer DEFAULT 100)
RETURNS TABLE (user_id uuid, username text, avatar_url text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.user_id, p.username, p.avatar_url
  FROM public.profiles p
  WHERE (_user_ids IS NULL OR p.user_id = ANY(_user_ids))
    AND (_search IS NULL OR p.username ILIKE '%' || _search || '%')
  ORDER BY p.username NULLS LAST
  LIMIT GREATEST(1, LEAST(COALESCE(_limit, 100), 500))
$$;
REVOKE ALL ON FUNCTION public.public_profiles(uuid[], text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.public_profiles(uuid[], text, integer) TO anon, authenticated, service_role;

-- 5. audio_source_tags: owner / org / admin only
DROP POLICY IF EXISTS "Anyone signed in can read tags" ON public.audio_source_tags;
CREATE POLICY "Users can read tags for their own sources" ON public.audio_source_tags
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR EXISTS (
      SELECT 1 FROM public.audio_sources s
      WHERE s.id = audio_source_tags.audio_source_id
        AND (s.user_id = auth.uid() OR (s.organization_id IS NOT NULL AND public.has_org_access(s.organization_id)))
    )
  );

-- 6. No anonymous execution of internal admin/worker helpers
REVOKE EXECUTE ON FUNCTION public.admin_list_people(text, integer, integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.admin_set_membership(uuid, text, text, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.claim_intuizi_score_jobs(integer, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.intuizi_activation_cost_estimate(integer, boolean, integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.log_intuizi_custody_scan() FROM anon;
REVOKE EXECUTE ON FUNCTION public.match_audioset_nodes(vector, integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.org_retention_summary(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.prune_embedding_cache(integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.prune_guest_run_limits(integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.refresh_taxonomy_grounding() FROM anon;
REVOKE EXECUTE ON FUNCTION public.upsert_category_calibration(jsonb) FROM anon;
REVOKE EXECUTE ON FUNCTION public.fingerprint_neighbors(numeric, numeric, numeric, numeric, numeric, numeric, integer) FROM anon;