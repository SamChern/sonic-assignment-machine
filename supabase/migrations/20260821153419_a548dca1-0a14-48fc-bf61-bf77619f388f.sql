-- profiles
DROP POLICY IF EXISTS "Profiles are viewable by everyone" ON public.profiles;
CREATE POLICY "Signed-in users can view profiles" ON public.profiles FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "Users can insert their own profile" ON public.profiles;
CREATE POLICY "Users can insert their own profile" ON public.profiles FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can update their own profile" ON public.profiles;
CREATE POLICY "Users can update their own profile" ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- audio_sources
DROP POLICY IF EXISTS "Audio sources are viewable by everyone" ON public.audio_sources;
CREATE POLICY "Signed-in users can view audio sources" ON public.audio_sources FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "Users can insert their own audio sources" ON public.audio_sources;
CREATE POLICY "Users can insert their own audio sources" ON public.audio_sources FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can update their own audio sources" ON public.audio_sources;
CREATE POLICY "Users can update their own audio sources" ON public.audio_sources FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can delete their own audio sources" ON public.audio_sources;
CREATE POLICY "Users can delete their own audio sources" ON public.audio_sources FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- user_fingerprints
DROP POLICY IF EXISTS "Everyone can view fingerprints" ON public.user_fingerprints;
CREATE POLICY "Signed-in users can view fingerprints" ON public.user_fingerprints FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "Users can insert their own fingerprint" ON public.user_fingerprints;
CREATE POLICY "Users can insert their own fingerprint" ON public.user_fingerprints FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can update their own fingerprint" ON public.user_fingerprints;
CREATE POLICY "Users can update their own fingerprint" ON public.user_fingerprints FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- source_cache
DROP POLICY IF EXISTS "Anyone can read source cache" ON public.source_cache;
CREATE POLICY "Signed-in users can read source cache" ON public.source_cache FOR SELECT TO authenticated USING (true);

-- source_analyses: scope existing policies to authenticated
DROP POLICY IF EXISTS "Users can view their own analyses" ON public.source_analyses;
CREATE POLICY "Users can view their own analyses" ON public.source_analyses FOR SELECT TO authenticated USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Admins can view all analyses" ON public.source_analyses;
CREATE POLICY "Admins can view all analyses" ON public.source_analyses FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'::app_role));
DROP POLICY IF EXISTS "Users can insert their own analyses" ON public.source_analyses;
CREATE POLICY "Users can insert their own analyses" ON public.source_analyses FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

-- revoke anon table access now that no policy allows anonymous reads
REVOKE ALL ON public.profiles FROM anon;
REVOKE ALL ON public.audio_sources FROM anon;
REVOKE ALL ON public.user_fingerprints FROM anon;
REVOKE ALL ON public.source_cache FROM anon;
REVOKE ALL ON public.source_analyses FROM anon;
REVOKE ALL ON public.audio_source_tags FROM anon;
REVOKE ALL ON public.taxonomy_nodes FROM anon;

GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.audio_sources TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.user_fingerprints TO authenticated;
GRANT SELECT ON public.source_cache TO authenticated;
GRANT SELECT, INSERT ON public.source_analyses TO authenticated;
GRANT ALL ON public.profiles TO service_role;
GRANT ALL ON public.audio_sources TO service_role;
GRANT ALL ON public.user_fingerprints TO service_role;
GRANT ALL ON public.source_cache TO service_role;
GRANT ALL ON public.source_analyses TO service_role;

-- SECURITY DEFINER function execute privileges: backend-only routines
REVOKE ALL ON FUNCTION public.acquire_intuizi_lease(text, integer) FROM anon, authenticated, public;
REVOKE ALL ON FUNCTION public.release_intuizi_lease(text) FROM anon, authenticated, public;
REVOKE ALL ON FUNCTION public.claim_analysis_jobs(integer) FROM anon, authenticated, public;
REVOKE ALL ON FUNCTION public.prune_analysis_telemetry(integer, integer, integer) FROM anon, authenticated, public;
REVOKE ALL ON FUNCTION public.recalculate_user_fingerprint(uuid) FROM anon, authenticated, public;
REVOKE ALL ON FUNCTION public.recalculate_all_fingerprints() FROM anon, authenticated, public;
GRANT EXECUTE ON FUNCTION public.acquire_intuizi_lease(text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_intuizi_lease(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_analysis_jobs(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.prune_analysis_telemetry(integer, integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.recalculate_user_fingerprint(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.recalculate_all_fingerprints() TO service_role;

-- client-callable definer functions: signed-in users only
REVOKE ALL ON FUNCTION public.match_audio_profiles(vector, integer, uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.match_audio_profiles(vector, integer, uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.has_role(uuid, app_role) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, app_role) TO authenticated, service_role;