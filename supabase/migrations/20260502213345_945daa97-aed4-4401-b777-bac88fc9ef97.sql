-- Bucket for admin-uploaded audio test samples (admin-only access).
INSERT INTO storage.buckets (id, name, public)
VALUES ('admin-audio-tests', 'admin-audio-tests', false)
ON CONFLICT (id) DO NOTHING;

-- Only admins can read/write this bucket.
CREATE POLICY "Admins can upload audio tests"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'admin-audio-tests'
  AND public.has_role(auth.uid(), 'admin')
);

CREATE POLICY "Admins can read audio tests"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'admin-audio-tests'
  AND public.has_role(auth.uid(), 'admin')
);

CREATE POLICY "Admins can delete audio tests"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'admin-audio-tests'
  AND public.has_role(auth.uid(), 'admin')
);