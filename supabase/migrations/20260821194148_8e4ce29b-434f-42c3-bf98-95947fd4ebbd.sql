REVOKE ALL ON FUNCTION public.touch_audio_profile_embedding(TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.touch_audio_profile_embedding(TEXT, TEXT) TO service_role;