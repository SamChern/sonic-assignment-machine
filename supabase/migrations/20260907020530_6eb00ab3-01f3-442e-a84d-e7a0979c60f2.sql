DROP POLICY IF EXISTS "Signed-in users can view audio sources" ON public.audio_sources;

CREATE POLICY "Users can view their own audio sources"
ON public.audio_sources FOR SELECT TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "Admins can view all audio sources"
ON public.audio_sources FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Org members can view org audio sources"
ON public.audio_sources FOR SELECT TO authenticated
USING (organization_id IS NOT NULL AND public.has_org_access(organization_id));

CREATE OR REPLACE VIEW public.audio_sources_public AS
SELECT id, user_id, name, artists, album_name, album_image, source_type, spotify_id,
       analysis_status, created_at
FROM public.audio_sources;

ALTER VIEW public.audio_sources_public SET (security_invoker = false);

GRANT SELECT ON public.audio_sources_public TO authenticated, anon;